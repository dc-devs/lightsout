import { join } from 'node:path';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { PlanningObservation } from '#src/plan/workflow/common/types/transport/PlanningObservation.ts';
import { planningErrorCode } from '#src/plan/workflow/store/common/utils/planningErrorCode.ts';
import { readPlanningFile } from '#src/plan/workflow/store/common/utils/readPlanningFile.ts';
import { PlanningAnchorReference } from '#src/plan/workflow/store/portable/common/types/PlanningAnchorReference.ts';
import { validatePlanningAnchorMarker } from '#src/plan/workflow/store/portable/common/validation/validatePlanningAnchorMarker.ts';
import { validatePlanningGeneration } from '#src/plan/workflow/store/portable/validatePlanningGeneration.ts';

interface Params {
	root: string;
	blobs: string;
	name: string;
}

/** Revalidate the selected anchor and every core blob on every read; an anchor is never a cached predecessor transition. */
export const readPlanningAnchor = async ({ root, blobs, name }: Params): Promise<PlanningSnapshot | undefined> => {
	let bytes: Buffer;
	try {
		bytes = await readPlanningFile({ path: join(root, 'anchor.json') });
	} catch (error) {
		if (planningErrorCode({ error }) === 'ENOENT') return undefined;
		throw error;
	}
	const reference = PlanningAnchorReference.parse(JSON.parse(bytes.toString('utf8')));
	if (!bytes.equals(Buffer.from(canonicalJson({ value: reference })))) throw new Error('Noncanonical planning anchor reference');
	if (reference.markerSha256 !== undefined)
		validatePlanningAnchorMarker({ text: (await readPlanningFile({ path: join(root, 'selected-marker.json') })).toString('utf8'), reference });
	const portable = await readPlanningFile({ path: join(blobs, reference.sha256) });
	if (!Buffer.from(portable.toString('utf8')).equals(portable)) throw new Error('Corrupt planning anchor encoding');
	const snapshot = validatePlanningGeneration({ text: portable.toString('utf8'), expectedDigest: reference.sha256, name });
	if (snapshot.digest !== reference.generation) throw new Error('Planning anchor generation differs from its selected reference');
	const artifacts = new Map(snapshot.artifacts);
	for (const descriptor of snapshot.record.artifacts) {
		let content: Buffer;
		try {
			content = await readPlanningFile({ path: join(blobs, descriptor.sha256) });
		} catch (error) {
			if (planningErrorCode({ error }) === 'ENOENT' && snapshot.omittedObservations?.some((item) => item.path === descriptor.path)) continue;
			throw error;
		}
		if (sha256({ content }) !== descriptor.sha256 || !Buffer.from(content.toString('utf8')).equals(content))
			throw new Error(`Corrupt anchored planning artifact: ${descriptor.path}`);
		const omitted = snapshot.omittedObservations?.find((item) => item.path === descriptor.path);
		if (omitted) {
			const { content: _source, ...metadata } = PlanningObservation.parse(JSON.parse(content.toString('utf8')));
			if (canonicalJson({ value: metadata }) !== canonicalJson({ value: omitted.observation }))
				throw new Error('Rehydrated observation differs from its anchored metadata');
		}
		artifacts.set(descriptor.path, content.toString('utf8'));
	}
	return { ...snapshot, artifacts };
};
