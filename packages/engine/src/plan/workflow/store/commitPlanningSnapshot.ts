import { link } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningRecord } from '#src/contracts/index.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import type { PlanningStoreIO } from '#src/plan/workflow/common/types/PlanningStoreIO.ts';
import { flushPlanningDirectory } from '#src/plan/workflow/store/common/utils/flushPlanningDirectory.ts';
import { planningErrorCode } from '#src/plan/workflow/store/common/utils/planningErrorCode.ts';
import { planningStorePaths } from '#src/plan/workflow/store/common/utils/planningStorePaths.ts';
import { writePlanningBlob } from '#src/plan/workflow/store/common/utils/writePlanningBlob.ts';
import { validatePlanningArtifactBodies } from '#src/plan/workflow/store/common/validation/validatePlanningArtifactBodies.ts';
import { validatePlanningTransition } from '#src/plan/workflow/store/common/validation/validatePlanningTransition.ts';
import { readPlanningSnapshot } from '#src/plan/workflow/store/readPlanningSnapshot.ts';
import { validatePlanningRecord } from '#src/plan/workflow/store/validatePlanningRecord.ts';

interface Params {
	cwd: string;
	name: string;
	expectedRevision: number;
	parentDigest: string | null;
	record: PlanningRecord;
	artifacts: ReadonlyMap<string, string>;
	io?: PlanningStoreIO;
}

const stageArtifacts = async ({
	record,
	artifacts,
	blobs,
	io,
	current,
}: {
	record: PlanningRecord;
	artifacts: ReadonlyMap<string, string>;
	blobs: string;
	io?: PlanningStoreIO;
	current?: PlanningSnapshot;
}) => {
	if ([...artifacts.keys()].some((path) => !record.artifacts.some((item) => item.path === path)))
		throw new Error('Planning artifact descriptors must name every staged artifact exactly once');
	for (const descriptor of record.artifacts) {
		const text = artifacts.get(descriptor.path);
		if (text === undefined && current?.omittedObservations?.some((item) => item.path === descriptor.path && item.sha256 === descriptor.sha256)) continue;
		if (text === undefined || sha256({ content: text }) !== descriptor.sha256)
			throw new Error(`Planning artifact does not match its descriptor: ${descriptor.path}`);
		const path = join(blobs, descriptor.sha256);
		await writePlanningBlob({ path, text });
		await io?.checkpoint?.({ operation: 'blob', path });
	}
	await flushPlanningDirectory({ path: blobs });
};

/** Publish a full immutable generation through an exclusive link; competing writers can never overwrite the winner. */
export const commitPlanningSnapshot = async ({
	cwd,
	name,
	expectedRevision,
	parentDigest,
	record: proposed,
	artifacts,
	io,
}: Params): Promise<{ committed: true; snapshot: PlanningSnapshot } | { committed: false; current: PlanningSnapshot }> => {
	const record = PlanningRecord.parse(proposed);
	if (record.planName !== name || record.revision !== expectedRevision + 1 || record.parentDigest !== parentDigest)
		throw new Error('Planning candidate has an inconsistent predecessor');
	const validation = validatePlanningRecord({ record });
	if (!validation.valid) throw new Error(`Invalid planning candidate: ${JSON.stringify(validation.issues)}`);
	const current = await readPlanningSnapshot({ cwd, name });
	if (current !== undefined && (current.record.revision !== expectedRevision || current.digest !== parentDigest)) return { committed: false, current };
	if (current === undefined && (expectedRevision !== -1 || parentDigest !== null)) throw new Error('Planning predecessor is missing');
	validatePlanningArtifactBodies({ record, artifacts });
	validatePlanningTransition({ previous: current, record, artifacts });
	const paths = await planningStorePaths({ cwd, name, create: true });
	await stageArtifacts({ record, artifacts, blobs: paths.blobs, io, current });
	const text = canonicalJson({ value: record });
	const digest = sha256({ content: text });
	const candidate = join(paths.staging, `${digest}.json`);
	await writePlanningBlob({ path: candidate, text: canonicalJson({ value: { digest, record } }) });
	await io?.checkpoint?.({ operation: 'candidate', path: candidate });
	const commit = join(paths.commits, `${String(record.revision).padStart(10, '0')}.json`);
	let committed = true;
	try {
		await link(candidate, commit);
	} catch (error) {
		if (!(planningErrorCode({ error }) === 'EEXIST')) throw error;
		committed = false;
	}
	if (committed) {
		await flushPlanningDirectory({ path: paths.commits });
		await io?.checkpoint?.({ operation: 'commit', path: commit });
	}
	const snapshot = await readPlanningSnapshot({ cwd, name, generation: committed ? digest : undefined });
	if (snapshot === undefined) throw new Error('Published planning generation could not be resolved');
	return committed ? { committed: true, snapshot } : { committed: false, current: snapshot };
};
