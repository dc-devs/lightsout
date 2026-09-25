import { planNumberOf } from '#src/common/planAddress/planNumberOf.ts';
import { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';

interface Params {
	record: WorkOrderState;
}

/**
 * Whether the work order is built from the ticket body with no plan: a
 * single-plan record that holds no plan 001. An excluded plan 001 still counts
 * as held, because the single-plan ship rule still refuses it by name.
 *
 * The queue decides to take the plan-less path and the body-build lifecycle
 * decides to record that build from this one fact, so the two can never
 * disagree about a ticket whose build must be recorded before it may ship.
 */
export const isPlanlessWorkOrder = ({ record }: Params): boolean =>
	record.mode === WorkOrderMode.SinglePlan && !record.plans.some((plan) => planNumberOf({ id: plan.id }) === 1);
