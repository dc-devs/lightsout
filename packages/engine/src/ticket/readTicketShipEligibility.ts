import { planNumberOf } from '#src/common/planAddress/planNumberOf.ts';
import { PlanProgress, WorkOrderMode, type WorkOrderState } from '#src/contracts/index.ts';
import type { TicketShipEligibility } from '#src/ticket/common/types/TicketShipEligibility.ts';

interface Params {
	record: WorkOrderState;
}

/** Plan 001 alone supplies a single-plan ticket's implementation, so it alone decides whether the ticket may ship. */
const readSinglePlanEligibility = ({ record }: Params): TicketShipEligibility => {
	const first = record.plans.find((plan) => planNumberOf({ id: plan.id }) === 1);
	let eligibility: TicketShipEligibility;

	if (first === undefined) {
		eligibility = { eligible: false, reason: `ticket ${record.branch} is in single-plan mode and holds no plan 001, so nothing supplies its implementation` };
	} else if (first.exclusion !== undefined) {
		eligibility = {
			eligible: false,
			reason: `plan ${first.id} is excluded from ticket ${record.branch} — ${first.exclusion.reason} — so a single-plan ticket has no implementation to ship`,
		};
	} else if (first.progress !== PlanProgress.Implemented) {
		eligibility = {
			eligible: false,
			reason: `the implementation of plan ${first.id} on ticket ${record.branch} has not finished, and a single-plan ticket ships once plan 001 is implemented`,
		};
	} else {
		eligibility = { eligible: true };
	}

	return eligibility;
};

/** How the approved set of plans and the ticket's current included plans differ, as the clauses of one sentence. */
const describeRequestDrift = ({ missing, stale }: { missing: string[]; stale: string[] }) => {
	const clauses = [
		...(missing.length === 0 ? [] : [`it does not name ${missing.join(', ')}`]),
		...(stale.length === 0 ? [] : [`it names ${stale.join(', ')}, which the ticket no longer includes`]),
	];

	return clauses.join(', and ');
};

/** A multiple-plan ticket ships only on a request that still names exactly its included plans, every one of them implemented. */
const readMultiplePlanEligibility = ({ record }: Params): TicketShipEligibility => {
	const included = record.plans.filter((plan) => plan.exclusion === undefined);
	const includedIds = included.map((plan) => plan.id);
	const request = record.shipRequest;
	const askAgain = `\`lightsout work-order request-ship --name ${record.branch} --plans ${includedIds.join(',')}\``;
	let eligibility: TicketShipEligibility;

	if (request === undefined) {
		eligibility = { eligible: false, reason: `ticket ${record.branch} is in multiple-plan mode and carries no ship request, so ask for one with ${askAgain}` };
	} else {
		const missing = includedIds.filter((id) => !request.planIds.includes(id));
		const stale = request.planIds.filter((id) => !includedIds.includes(id));
		const waiting = included.find((plan) => plan.progress !== PlanProgress.Implemented);

		if (missing.length > 0 || stale.length > 0) {
			eligibility = {
				eligible: false,
				reason: `the ship request on ticket ${record.branch} no longer names the plans it holds — ${describeRequestDrift({ missing, stale })} — so request shipping again with ${askAgain}`,
			};
		} else if (waiting !== undefined) {
			eligibility = {
				eligible: false,
				reason: `the implementation of plan ${waiting.id} on ticket ${record.branch} has not finished, and every plan its ship request names is implemented before the ticket ships`,
			};
		} else {
			eligibility = { eligible: true };
		}
	}

	return eligibility;
};

/**
 * Whether a ticket's own record authorizes shipping it, and one sentence saying
 * why not when it does not.
 *
 * A branch carrying no record at all is the caller's own case and ships exactly
 * as it did before ticket records existed; this function is only ever handed a
 * record. A record that already says the ticket shipped is never eligible
 * again, whatever its plans say — the merged record is history.
 *
 * A plan's display title takes no part in any of it, which is what makes a
 * rename something that never withdraws an approval.
 */
export const readTicketShipEligibility = ({ record }: Params): TicketShipEligibility => {
	let eligibility: TicketShipEligibility;

	if (record.shipped !== undefined) {
		eligibility = {
			eligible: false,
			reason: `ticket ${record.branch} already shipped as ${record.shipped.mergeCommit}, so its record no longer authorizes a merge`,
		};
	} else if (record.mode === WorkOrderMode.SinglePlan) {
		eligibility = readSinglePlanEligibility({ record });
	} else {
		eligibility = readMultiplePlanEligibility({ record });
	}

	return eligibility;
};
