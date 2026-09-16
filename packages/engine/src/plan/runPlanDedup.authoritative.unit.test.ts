import { readFile } from 'node:fs/promises';
import { expect, test } from '@jest/globals';
import { PlanningVocabulary as V } from '#src/contracts/index.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import { runPlanDedup, runPlanGrade, runPlanning } from '#src/plan/index.ts';
import { planningReviewFixture } from '#tests/helpers/planningReviewFixture.ts';

test('reports canonical prior-art work as incomplete until actual investigation and independent reviews finish', async () => {
	const fixture = await planningReviewFixture();
	expect((await fixture.run()).status).toBe(V.Status.Complete);
	const calls = fixture.calls.length;
	const first = await runPlanDedup({ runtime: fixture.runtime });
	if (first.status !== PlanRunStatus.Complete) throw new Error('Expected deterministic dedup report');
	expect(first.dedup).toMatchObject({
		complete: false,
		findings: [],
		reviewed: [],
		workflow: { format: 'planning-dedup-v1', observationArtifacts: [expect.stringMatching(/^planning-prior-art\//)] },
	});
	expect(first.dedup.incompleteReason).toBeTruthy();
	expect(JSON.parse(await readFile(first.dedupPath, 'utf8'))).toStrictEqual(first.dedup);
	expect(fixture.calls).toHaveLength(calls);
	expect((await runPlanning({ runtime: fixture.runtime })).status).toBe(V.Status.Complete);
	const completedCalls = fixture.calls.length;
	const second = await runPlanDedup({ runtime: fixture.runtime });
	expect(second).toMatchObject({ status: PlanRunStatus.Complete, dedup: { complete: true, findings: [], reviewed: [] } });
	expect(fixture.calls).toHaveLength(completedCalls);
	const grade = await runPlanGrade({ runtime: fixture.runtime });
	expect(grade).toMatchObject({ status: PlanRunStatus.Complete, grade: { passed: true, complete: true, grade: 'A' } });
	expect(fixture.calls).toHaveLength(completedCalls);
}, 60_000);

test('refuses absent canonical inputs at both public report boundaries without invoking a provider', async () => {
	const fixture = await planningReviewFixture();
	expect(await runPlanDedup({ runtime: fixture.runtime })).toMatchObject({ status: PlanRunStatus.Failed, error: expect.stringMatching(/unavailable/) });
	expect(await runPlanGrade({ runtime: fixture.runtime })).toMatchObject({ status: PlanRunStatus.Failed, error: expect.any(String) });
	expect(fixture.calls).toHaveLength(0);
});
