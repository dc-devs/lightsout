import { planNumberOf } from '#src/common/planAddress/planNumberOf.ts';
import type { WorkOrderPlan, WorkOrderState } from '#src/contracts/index.ts';

interface Params {
	record: WorkOrderState;
	/** A full plan id, or the plan's number on its own — `2`, `02` and `002` all name plan 002. */
	token: string;
}

/**
 * The plan a human named at the terminal, or the one sentence listing the ids
 * the ticket does hold.
 *
 * A bare number is accepted because a plan's number is what a human reads off
 * `lightsout work-order show`, while the full id is what every record and
 * attachment carries; both name the same plan and neither is ambiguous, since
 * no ticket ever reuses a number.
 */
export const resolveWorkOrderPlan = ({ record, token }: Params): WorkOrderPlan | { error: string } => {
	const numbered = /^\d{1,3}$/.test(token) ? record.plans.find((plan) => planNumberOf({ id: plan.id }) === Number(token)) : undefined;
	const plan = record.plans.find((candidate) => candidate.id === token) ?? numbered;
	const held = record.plans.length === 0 ? 'it holds no plans' : `it holds ${record.plans.map((candidate) => candidate.id).join(', ')}`;

	return plan ?? { error: `work order ${record.name} holds no plan '${token}' — ${held}` };
};
