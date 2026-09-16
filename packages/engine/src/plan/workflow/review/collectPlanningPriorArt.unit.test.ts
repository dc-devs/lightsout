import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { commitPlanningSnapshot, evaluatePlanningReadiness, readPlanningSnapshot } from '#src/plan/index.ts';
import { collectPlanningPriorArt } from '#src/plan/workflow/review/index.ts';
import { planningClaimedWorkflowFixture } from '#tests/helpers/planningClaimedWorkflowFixture.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';

const setup = async () => {
	const fixture = await planningReviewFixture({
		respond: ({ response }) =>
			response.role === PlanningVocabulary.Role.Architect && response.kind === PlanningVocabulary.ResultKind.Terminal
				? { ...response, artifactLayouts: response.artifactLayouts?.map((layout) => ({ ...layout, exports: ['retryUpload'] })) }
				: response,
	});
	expect((await fixture.run()).status).toBe(PlanningVocabulary.Status.Complete);
	return fixture;
};

test('records actual prior-art candidates without inventing duplication findings or review completion', async () => {
	const fixture = await setup();
	const before = await fixture.current();
	await writeFile(join(fixture.cwd, 'retryUpload.ts'), 'export const retryUpload = () => "preserve completion";');
	const after = await collectPlanningPriorArt({ runtime: fixture.runtime, snapshot: before });
	const entry = [...after.artifacts].find(([path]) => path.startsWith('planning-prior-art/'));
	if (!entry) throw new Error('Expected canonical prior-art data');
	const data = JSON.parse(entry[1]);
	expect(data.symbols).toStrictEqual(['retryUpload']);
	expect(data.candidates).toStrictEqual([{ symbol: 'retryUpload', collidesWith: [{ name: 'retryUpload', path: 'retryUpload.ts' }] }]);
	expect(data.dependencies).toEqual(expect.arrayContaining([expect.objectContaining({ kind: PlanningVocabulary.Dependency.Membership })]));
	expect(after.record.findings).toStrictEqual(before.record.findings);
	expect(after.record.reviewReceipts).toStrictEqual(before.record.reviewReceipts);
	expect(after.record.work.filter((work) => work.id.startsWith('prior-art:'))).toEqual([
		expect.objectContaining({ role: PlanningVocabulary.Role.Investigate, status: PlanningVocabulary.WorkState.Pending }),
	]);
	expect(evaluatePlanningReadiness({ snapshot: after, stage: fixture.runtime.stage, structural: [], dependenciesCurrent: true }).ready).toBe(false);
	const reused = await collectPlanningPriorArt({ runtime: fixture.runtime, snapshot: after });
	expect(reused.digest).toBe(after.digest);
	expect(reused.record).toStrictEqual(after.record);
}, 60_000);

test('attaches a census to its actual current investigation without adding another assignment', async () => {
	const fixture = await planningClaimedWorkflowFixture();
	const after = await collectPlanningPriorArt({ runtime: fixture.runtime, snapshot: fixture.snapshot, work: fixture.work });
	expect(after.record.work).toStrictEqual(fixture.snapshot.record.work);
	expect(after.record.evidence).toContainEqual(expect.objectContaining({ assignmentId: fixture.work.id }));
	expect(after.record.reviewReceipts).toStrictEqual([]);
	expect(fixture.calls).toHaveLength(0);
});

test('refuses stale export inventories before publishing census data', async () => {
	const fixture = await setup();
	const before = await fixture.current();
	const record = structuredClone(before.record);
	const view = record.artifacts.find((artifact) => artifact.variant === PlanningVocabulary.Artifact.Single);
	if (!view) throw new Error('Expected actual mutable plan view');
	view.exports.push('newUnreviewedExport');
	const changed = await commitPlanningSnapshot({
		...fixture,
		expectedRevision: before.record.revision,
		parentDigest: before.digest,
		record: { ...record, revision: record.revision + 1, parentDigest: before.digest },
		artifacts: before.artifacts,
	});
	if (!changed.committed) throw new Error('Expected concurrent plan change');
	const calls = fixture.calls.length;
	await expect(collectPlanningPriorArt({ runtime: fixture.runtime, snapshot: before })).rejects.toThrow('Planned exports changed');
	expect((await fixture.current()).digest).toBe(changed.snapshot.digest);
	expect(fixture.calls).toHaveLength(calls);
}, 60_000);

test('refuses foreign investigation attempts before publishing census data', async () => {
	const fixture = await planningClaimedWorkflowFixture();
	for (const work of [
		{ ...fixture.work, currentAttemptId: 'foreign-attempt' },
		{ ...fixture.work, id: 'foreign-work' },
	])
		await expect(collectPlanningPriorArt({ runtime: fixture.runtime, snapshot: fixture.snapshot, work })).rejects.toThrow('lost its assigned attempt');
	expect((await readPlanningSnapshot(fixture))?.digest).toBe(fixture.snapshot.digest);
	expect(fixture.calls).toHaveLength(0);
});

test('publishes a shared concurrent census only once after the losing writer rereads the current generation', async () => {
	const fixture = await planningClaimedWorkflowFixture();
	const results = await Promise.all([
		collectPlanningPriorArt({ runtime: fixture.runtime, snapshot: fixture.snapshot }),
		collectPlanningPriorArt({ runtime: fixture.runtime, snapshot: fixture.snapshot }),
	]);
	expect(results[0].digest).toBe(results[1].digest);
	const current = await readPlanningSnapshot(fixture);
	expect(current?.record.artifacts.filter((artifact) => artifact.path.startsWith('planning-prior-art/'))).toHaveLength(1);
	expect(current?.record.work.filter((work) => work.id.startsWith('prior-art:'))).toHaveLength(1);
});
