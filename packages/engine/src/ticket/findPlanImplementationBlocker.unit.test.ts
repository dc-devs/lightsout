import { describe, expect, test } from '@jest/globals';
import { PlanProgress, TicketMode, type TicketPlan, type TicketRecord } from '#src/contracts/index.ts';
import { findPlanImplementationBlocker } from '#src/ticket/index.ts';

/**
 * One plan of a ticket's record, carrying only what the order rule reads: its
 * id, how far it got, the run it recorded, and the exclusion that takes it out
 * of the order.
 */
const planWith = ({
	id,
	progress,
	runId,
	excludedFor,
}: {
	id: string;
	progress: PlanProgress;
	/** The run recorded against this plan, which a refusal names when there is one to resume. */
	runId?: string;
	/** The recorded reason, whose presence is what makes the plan an excluded one. */
	excludedFor?: string;
}): TicketPlan => ({
	id,
	title: `Plan ${id}`,
	progress,
	createdAt: '2026-03-01T00:00:00.000Z',
	...(runId === undefined ? {} : { implementation: { runId, startedAt: '2026-03-02T09:00:00.000Z', startCommit: 'c0ffee1' } }),
	...(excludedFor === undefined ? {} : { exclusion: { at: '2026-03-03T09:00:00.000Z', reason: excludedFor, implementationRemoved: false } }),
});

/** A ticket record on branch `lo-140-multi`, in whichever mode and with whichever plans the test needs. */
const setupTicket = ({ mode = TicketMode.MultiplePlan, plans = [] }: { mode?: TicketMode; plans?: TicketPlan[] } = {}) => {
	const record: TicketRecord = {
		schemaVersion: 1,
		ticketRef: 'LO-140',
		branch: 'lo-140-multi',
		mode,
		plans,
		history: [],
	};

	return { record };
};

describe('findPlanImplementationBlocker', () => {
	test.each([
		{ progress: PlanProgress.Planning },
		{ progress: PlanProgress.Ready },
		{ progress: PlanProgress.Implementing },
		{ progress: PlanProgress.Failed },
	])('allows plan 001 of a single-plan ticket in any progress short of implemented', ({ progress }) => {
		const { record } = setupTicket({ mode: TicketMode.SinglePlan, plans: [planWith({ id: '001-record', progress })] });

		const blocker = findPlanImplementationBlocker({ record, planId: '001-record' });

		expect(blocker).toBeUndefined();
	});

	test('allows a plan whose every lower plan is implemented or excluded', () => {
		const { record } = setupTicket({
			plans: [
				planWith({ id: '001-record', progress: PlanProgress.Implemented }),
				planWith({ id: '002-addressing', progress: PlanProgress.Failed, runId: 'run-2b7e', excludedFor: 'replaced by 003' }),
				planWith({ id: '003-queue-order', progress: PlanProgress.Ready }),
			],
		});

		const blocker = findPlanImplementationBlocker({ record, planId: '003-queue-order' });

		expect(blocker).toBeUndefined();
	});

	test('refuses a plan the record does not hold and names ticket show', () => {
		const { record } = setupTicket({ plans: [planWith({ id: '001-record', progress: PlanProgress.Implemented })] });

		const blocker = findPlanImplementationBlocker({ record, planId: '004-nothing-here' });

		expect(blocker).toContain('004-nothing-here');
		expect(blocker).toContain('lightsout ticket show');
	});

	test('refuses an excluded plan and names its reason and ticket add-plan', () => {
		const { record } = setupTicket({
			plans: [
				planWith({ id: '001-record', progress: PlanProgress.Implemented }),
				planWith({ id: '002-addressing', progress: PlanProgress.Ready, excludedFor: 'switched to single-plan mode' }),
			],
		});

		const blocker = findPlanImplementationBlocker({ record, planId: '002-addressing' });

		expect(blocker).toContain('002-addressing');
		expect(blocker).toContain('switched to single-plan mode');
		expect(blocker).toContain('lightsout ticket add-plan');
	});

	test('refuses a plan other than 001 in single-plan mode and names the mode switch', () => {
		const { record } = setupTicket({
			mode: TicketMode.SinglePlan,
			plans: [planWith({ id: '001-record', progress: PlanProgress.Implemented }), planWith({ id: '002-addressing', progress: PlanProgress.Ready })],
		});

		const blocker = findPlanImplementationBlocker({ record, planId: '002-addressing' });

		expect(blocker).toContain('002-addressing');
		expect(blocker).toContain('lightsout ticket mode');
		expect(blocker).toContain('--set multiple-plan');
	});

	test('refuses an implemented plan and names ticket add-plan for follow-up work', () => {
		const { record } = setupTicket({ plans: [planWith({ id: '001-record', progress: PlanProgress.Implemented })] });

		const blocker = findPlanImplementationBlocker({ record, planId: '001-record' });

		expect(blocker).toContain('001-record');
		expect(blocker).toContain('lightsout ticket add-plan');
	});

	test.each([
		{
			progress: PlanProgress.Failed,
			runId: 'run-5c1a',
			expected: ['001-record', 'lightsout resume --run', 'run-5c1a', 'lightsout ticket exclude-plan'],
		},
		{
			progress: PlanProgress.Ready,
			runId: undefined,
			expected: ['001-record', 'lightsout implement --plan', '.lightsout/plans/lo-140-multi/001-record', 'lightsout ticket exclude-plan'],
		},
	])('refuses behind the lowest lower plan that is not implemented and names how to resolve it', ({ progress, runId, expected }) => {
		const { record } = setupTicket({
			plans: [
				planWith({ id: '001-record', progress, runId }),
				planWith({ id: '002-addressing', progress: PlanProgress.Planning }),
				planWith({ id: '003-queue-order', progress: PlanProgress.Ready }),
			],
		});

		const blocker = findPlanImplementationBlocker({ record, planId: '003-queue-order' });

		expect(blocker).toContain(expected[0]);
		expect(blocker).toContain(expected[1]);
		expect(blocker).toContain(expected[2]);
		expect(blocker).toContain(expected[3]);
		expect(blocker).not.toContain('unfinished');
	});
});
