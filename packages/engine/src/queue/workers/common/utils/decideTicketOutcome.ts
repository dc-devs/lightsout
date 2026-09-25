import { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import { readWorkOrderShipEligibility } from '#src/workOrder/readWorkOrderShipEligibility.ts';

interface Params {
	record: WorkOrderState;
}

/** What the record says about the ticket once there is nothing left to build: ship it, leave it open, or park it. */
export const decideTicketOutcome = ({ record }: Params): WorkerOutcome => {
	const eligibility = readWorkOrderShipEligibility({ record });

	if (eligibility.eligible) {
		return {};
	}

	// A single-plan work order is never left open: plan 001 — or, when it holds
	// none, the build from the ticket body — alone supplies its implementation,
	// so anything short of that is a human's to look at.
	return record.mode === WorkOrderMode.MultiplePlan ? { open: eligibility.reason } : { error: eligibility.reason };
};
