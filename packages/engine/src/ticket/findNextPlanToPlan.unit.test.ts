import { describe, expect, test } from '@jest/globals';
import { PlanProgress, WorkOrderMode, type WorkOrderPlan, type WorkOrderState } from '#src/contracts/index.ts';
import { findNextPlanToPlan } from '#src/ticket/index.ts';

/**
 * One plan of a ticket's record, carrying only what the planning-order rule
 * reads: its id, how far it got, and the exclusion that takes it out of the
 * order.
 */
const planWith = ({
	id,
	progress,
	excludedFor,
}: {
	id: string;
	progress: PlanProgress;
	/** The recorded reason, whose presence is what makes the plan an excluded one. */
	excludedFor?: string;
}): WorkOrderPlan => ({
	id,
	title: `Plan ${id}`,
	progress,
	createdAt: '2026-03-01T00:00:00.000Z',
	...(excludedFor === undefined ? {} : { exclusion: { at: '2026-03-03T09:00:00.000Z', reason: excludedFor, implementationRemoved: false } }),
});

/** A ticket record on branch `lo-140-multi` holding whichever plans the test needs. */
const setupTicket = ({ plans = [] }: { plans?: WorkOrderPlan[] } = {}) => {
	const record: WorkOrderState = {
		schemaVersion: 1,
		ticketRef: 'LO-140',
		branch: 'lo-140-multi',
		mode: WorkOrderMode.MultiplePlan,
		plans,
		history: [],
	};

	return { record };
};

describe('findNextPlanToPlan', () => {
	test('findNextPlanToPlan: answers the lowest non-excluded plan still being planned, or nothing', () => {
		const { record: withPlanWaiting } = setupTicket({
			plans: [
				planWith({ id: '001-record', progress: PlanProgress.Implemented }),
				planWith({ id: '002-addressing', progress: PlanProgress.Planning, excludedFor: 'replaced by 003' }),
				planWith({ id: '003-queue-order', progress: PlanProgress.Planning }),
			],
		});
		const { record: withNothingWaiting } = setupTicket({
			plans: [
				planWith({ id: '001-record', progress: PlanProgress.Implemented }),
				planWith({ id: '002-addressing', progress: PlanProgress.Ready }),
				planWith({ id: '003-queue-order', progress: PlanProgress.Planning, excludedFor: 'switched to single-plan mode' }),
			],
		});

		const waiting = findNextPlanToPlan({ record: withPlanWaiting });
		const nothing = findNextPlanToPlan({ record: withNothingWaiting });

		expect(waiting).toEqual(expect.objectContaining({ id: '003-queue-order', progress: 'planning' }));
		expect(nothing).toBeUndefined();
	});
});
