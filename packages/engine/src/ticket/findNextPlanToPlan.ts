import { PlanProgress, type WorkOrderPlan, type WorkOrderState } from '#src/contracts/index.ts';

interface Params {
	record: WorkOrderState;
}

/**
 * The plan of a ticket that planning works on next: the lowest-numbered plan
 * nothing has excluded whose planning has not finished.
 *
 * Lowest-first, the same order building follows, so the plan a session is asked
 * to write is always the one the build loop will take up next.
 *
 * It lives here rather than in the queue because two consumers outside the
 * ticket module apply it — the queue's choice of what its auto-plan session
 * plans, and the board's planning block — and two private copies would let the
 * board show a different plan from the one the session is writing.
 *
 * @returns the plan still being planned, or undefined when none is waiting
 */
export const findNextPlanToPlan = ({ record }: Params): WorkOrderPlan | undefined =>
	record.plans.find((plan) => plan.exclusion === undefined && plan.progress === PlanProgress.Planning);
