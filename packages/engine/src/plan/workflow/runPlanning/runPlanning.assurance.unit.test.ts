import { expect, test } from '@jest/globals';
import { answerPlanningQuestion, readPlanningSnapshot, runPlanning } from '#src/plan/index.ts';
import { planningUnknownWorkflowFixture } from '#tests/helpers/planningUnknownWorkflowFixture.ts';
import { planningQuestionAnswer } from '#tests/helpers/planningWorkflowQuestionScenario.ts';

test('requires explicit independent assurance for omitted reach and refreshes it on a later entry', async () => {
	const fixture = await planningUnknownWorkflowFixture();

	const question = await runPlanning({ runtime: fixture.runtime });
	if (question.status !== 'awaiting-user') throw new Error(`Expected explicit approval after assurance: ${JSON.stringify(question)}`);
	const first = await answerPlanningQuestion({
		runtime: fixture.runtime,
		answer: planningQuestionAnswer({ result: question, delegation: fixture.scope, alignment: true }),
	});
	const before = await readPlanningSnapshot(fixture);
	const firstCalls = fixture.assuranceCalls.length;
	const second = await runPlanning({ runtime: fixture.runtime });
	const after = await readPlanningSnapshot(fixture);

	expect(first.status).toBe('aligned');
	expect(second.status).toBe('aligned');
	expect(firstCalls).toBeGreaterThan(0);
	expect(fixture.assuranceCalls.length).toBeGreaterThan(firstCalls);
	expect(before?.record.evidence.some((evidence) => evidence.dependencies.some((dependency) => dependency.kind === 'unknown'))).toBe(true);
	expect(after?.record.work.find((work) => work.id === 'initial:investigate')?.currentAttemptId).toBe(
		before?.record.work.find((work) => work.id === 'initial:investigate')?.currentAttemptId,
	);
	expect(after?.record.work.filter((work) => work.id.startsWith('assurance:')).every((work) => work.status === 'complete')).toBe(true);
});

test('returns a concrete external blocker when omitted information is required rather than certifying completeness', async () => {
	const fixture = await planningUnknownWorkflowFixture({ unavailable: true });

	const result = await runPlanning({ runtime: fixture.runtime });
	const snapshot = await readPlanningSnapshot(fixture);

	expect(result).toEqual(expect.objectContaining({ status: 'externally-blocked', cause: expect.stringContaining('linked-handler.ts') }));
	expect(fixture.assuranceCalls).toHaveLength(1);
	expect(snapshot?.record.work.some((work) => work.role === 'draft')).toBe(false);
	expect(snapshot?.record.reviewReceipts.some((receipt) => receipt.role === 'integration-review')).toBe(false);
});
