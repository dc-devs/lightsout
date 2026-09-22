import { planNumberOf } from '#src/common/planAddress/planNumberOf.ts';
import { WorkOrderEventKind, type WorkOrderState } from '#src/contracts/index.ts';
import { TicketSyncKeep } from '#src/ticket/common/constants/TicketSyncKeep.ts';

interface Params {
	/** The copy the human chose to keep. */
	kept: WorkOrderState;
	/** The copy being set aside, whose one-sided plans still have to survive. */
	other: WorkOrderState;
	keptFrom: TicketSyncKeep;
	/** The moment the carry is recorded at. */
	at: string;
}

/**
 * Carry into the kept record every plan only the other copy holds, so settling
 * a divergence never loses a plan or frees a number for reuse.
 *
 * A plan one machine added while the other was offline is real work with a real
 * folder; dropping it would also let the next `ticket add-plan` hand its number
 * to something else, and a number is never reused. Each carry appends one
 * `plan-added` event saying which copy it came from, because the kept record's
 * own history has no other way to explain how the plan got there.
 *
 * Two different plans under one number is the case no kept record can hold, so
 * it refuses rather than choosing: both ids are named, and the human decides.
 */
export const mergeOneSidedPlans = ({ kept, other, keptFrom, at }: Params): WorkOrderState | { error: string } => {
	const source = keptFrom === TicketSyncKeep.Local ? TicketSyncKeep.Published : TicketSyncKeep.Local;
	const held = new Map(kept.plans.map((plan) => [planNumberOf({ id: plan.id }), plan]));
	const carried: WorkOrderState['plans'] = [];

	for (const plan of other.plans) {
		const sameNumber = held.get(planNumberOf({ id: plan.id }));

		if (sameNumber === undefined) {
			carried.push(plan);
		} else if (sameNumber.id !== plan.id) {
			return {
				error: `the local and published copies of the ticket record both use plan number ${plan.id.slice(0, 3)}, for '${keptFrom === TicketSyncKeep.Local ? sameNumber.id : plan.id}' here and for '${keptFrom === TicketSyncKeep.Local ? plan.id : sameNumber.id}' on the ticket — no kept record can hold both, so rename or remove one of them before syncing`,
			};
		}
	}

	if (carried.length === 0) {
		return kept;
	}

	return {
		...kept,
		plans: [...kept.plans, ...carried].sort((left, right) => planNumberOf({ id: left.id }) - planNumberOf({ id: right.id })),
		history: [
			...kept.history,
			...carried.map((plan) => ({
				at,
				kind: WorkOrderEventKind.PlanAdded,
				detail: `carried plan ${plan.id} over from the ${source} copy of the ticket record while keeping the ${keptFrom} copy`,
			})),
		],
	};
};
