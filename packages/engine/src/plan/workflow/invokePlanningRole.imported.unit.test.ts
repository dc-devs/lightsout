import { describe, expect, test } from '@jest/globals';
import { invokePlanningRole } from '#src/plan/index.ts';
import { claimPlanningAttempt, recoverImportedPlanningAttempts } from '#src/plan/workflow/store/index.ts';
import { planningImportedAttemptFixture } from '#tests/helpers/planningImportedAttemptFixture.ts';

const setup = async () => {
	const context = await planningImportedAttemptFixture();
	const recovered = await recoverImportedPlanningAttempts(context);
	const pending = recovered?.record.work.find((item) => item.id === context.fixture.work.id);
	if (!pending) throw new Error('Missing recovered work');
	const claimed = await claimPlanningAttempt({ runtime: context.runtime, workId: pending.id, expectedInputDigest: pending.inputDigest });
	if (!claimed.claimed) throw new Error('Fresh recovered work must be claimable');
	const work = claimed.snapshot.record.work.find((item) => item.id === pending.id);
	if (!work) throw new Error('Missing fresh attempt');
	return { ...context, snapshot: claimed.snapshot, work };
};

describe('invokePlanningRole', () => {
	test('reacquires omitted source under a fresh imported attempt', async () => {
		const context = await setup();

		const result = await invokePlanningRole(context);

		expect(result.kind).toBe('terminal');
		expect(context.work.attemptSequence).toBe(context.fixture.work.attemptSequence + 1);
		expect(context.work.currentAttemptId).not.toBe(context.fixture.work.currentAttemptId);
		expect(context.prompts).toHaveLength(1);
		expect(context.prompts[0]).toContain('restoredAdapter');
		expect(context.prompts[0]).not.toContain('previousAdapter');
	});
});
