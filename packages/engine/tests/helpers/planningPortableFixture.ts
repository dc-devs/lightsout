import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import {
	attachPlanningData,
	commitPlanningSnapshot,
	exportPlanningGeneration,
	installPlanningGeneration,
	readPlanningEvidence,
	readPlanningSnapshot,
} from '#src/plan/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';

export const planningPortableFixture = async ({ complete = false }: { complete?: boolean } = {}) => {
	const fixture = await planningReviewFixture();
	if (complete) await fixture.run();
	else await fixture.capture();
	await writeFile(join(fixture.cwd, 'sample.ts'), 'export const privateSource = "local only";');
	const request = { requestId: 'portable-source', operation: PlanningVocabulary.Operation.ReadFile, path: 'sample.ts', reason: 'Read exact adapter behavior' };
	const before = await fixture.current();
	const observation = { request, ...(await readPlanningEvidence({ runtime: fixture.runtime, assignmentId: before.record.work[0].id, request })) };
	const record = structuredClone(before.record);
	const artifacts = new Map(before.artifacts);
	const observationPath = `planning-observations/${sha256({ content: canonicalJson({ value: observation }) })}.json`;
	attachPlanningData({ record, artifacts, path: observationPath, value: observation });
	attachPlanningData({ record, artifacts, path: 'custom-data.json', value: { required: 'core contract metadata' } });
	const saved = await commitPlanningSnapshot({
		...fixture,
		expectedRevision: before.record.revision,
		parentDigest: before.digest,
		record: { ...record, revision: before.record.revision + 1, parentDigest: before.digest },
		artifacts,
	});
	if (!saved.committed) throw new Error('Fixture lost its snapshot commit');
	const files = exportPlanningGeneration({ snapshot: saved.snapshot });
	const text = files.get('planning-record.json');
	if (!text) throw new Error('Missing portable export');
	const restore = async ({ body = text }: { body?: string } = {}) => {
		const cwd = await freshCwd();
		const root = join(cwd, '.lightsout', 'plans', fixture.name);
		await mkdir(root, { recursive: true });
		await installPlanningGeneration({ directory: root, name: fixture.name, text: body, expectedDigest: sha256({ content: body }) });
		const snapshot = await readPlanningSnapshot({ cwd, name: fixture.name });
		if (!snapshot) throw new Error('Restored anchor vanished');
		return { cwd, name: fixture.name, root, snapshot };
	};
	return { ...fixture, snapshot: saved.snapshot, files, text, observationPath, observation, restore };
};
