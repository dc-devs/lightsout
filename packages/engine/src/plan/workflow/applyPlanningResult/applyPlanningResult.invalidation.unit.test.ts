import { expect, test } from '@jest/globals';
import { PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import { applyPlanningResult, readPlanningSnapshot } from '#src/plan/index.ts';
import { planningRoleProposalFixture } from '#tests/helpers/planningRoleProposalFixture.ts';

const setup = async ({ variant }: { variant: string }) => {
	const fixture = await planningRoleProposalFixture({ role: PlanningVocabulary.Role.Repair });
	fixture.runtime.services.invalidate = () => {
		const additional: PlanningWork = {
			...fixture.work,
			id: variant === 'duplicate' ? fixture.work.id : 'new-followup',
			role: PlanningVocabulary.Role.Investigate,
			status: variant === 'started' ? PlanningVocabulary.WorkState.Running : PlanningVocabulary.WorkState.Pending,
			attemptSequence: variant === 'sequence' ? 1 : 0,
			currentAttemptId: undefined,
			resultReceiptId: undefined,
			prerequisiteIds: [],
		};
		return {
			workIds: variant === 'self' ? [fixture.work.id] : [],
			receiptIds: [],
			reason: 'A changed contract needs focused investigation',
			...(variant === 'self' ? {} : { work: [additional] }),
		};
	};
	return fixture;
};

test.each(['self', 'duplicate', 'started', 'sequence'])('refuses an invalid acceptance-time invalidation policy: %s', async (variant) => {
	const fixture = await setup({ variant });

	await expect(applyPlanningResult({ runtime: fixture.runtime, result: fixture.result })).rejects.toThrow(/cannot invalidate its own|new unstarted obligation/);

	expect((await readPlanningSnapshot(fixture))?.digest).toBe(fixture.before.digest);
});

test('publishes a new unresolved obligation atomically with its causative accepted edit', async () => {
	const fixture = await setup({ variant: 'new' });

	const result = await applyPlanningResult({ runtime: fixture.runtime, result: fixture.result });

	expect(result.accepted).toBe(true);
	expect(result.snapshot.record.work.find((work) => work.id === 'new-followup')).toEqual(
		expect.objectContaining({ role: 'investigate', status: 'pending', attemptSequence: 0 }),
	);
	expect(result.snapshot.record.work.find((work) => work.id === fixture.work.id)?.status).toBe('complete');
	expect(result.snapshot.artifacts.get('plan.md')).toContain('Resolved scenarios:');
});
