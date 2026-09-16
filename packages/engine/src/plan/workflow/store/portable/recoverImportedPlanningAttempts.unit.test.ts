import { describe, expect, test } from '@jest/globals';

import { readPlanningSnapshot, recoverImportedPlanningAttempts } from '#src/plan/workflow/store/index.ts';

import { planningImportedAttemptFixture as setup } from '#tests/helpers/planningImportedAttemptFixture.ts';

describe('recoverImportedPlanningAttempts', () => {
	test('records imported interruption without attributing source-checkout work to this checkout', async () => {
		const context = await setup();

		const recovered = await recoverImportedPlanningAttempts(context);

		expect(recovered?.record.revision).toBe(context.original.record.revision + 2);
		const pending = recovered?.record.work.find((item) => item.id === context.fixture.work.id);
		expect(pending).toEqual(expect.objectContaining({ status: 'pending', attemptSequence: context.fixture.work.attemptSequence }));
		expect(pending?.currentAttemptId).toBeUndefined();
		const interrupted = await readPlanningSnapshot({ ...context, generation: recovered?.record.parentDigest ?? '' });
		expect(interrupted?.record.work.find((item) => item.id === context.fixture.work.id)?.status).toBe('interrupted');
		expect((await readPlanningSnapshot(context.fixture))?.digest).toBe(context.original.digest);
	});
});
