import { PlanProgress } from '#src/contracts/workOrder/PlanProgress.ts';
import type { WorkerOutcome } from '#src/queue/internal/common/types/WorkerOutcome.ts';
import type { WorkOrderPlanStep } from '#src/queue/workers/internal/common/types/WorkOrderPlanStep.ts';
import { buildFromTicketBody } from '#src/queue/workers/internal/common/utils/buildFromTicketBody.ts';
import { decideTicketOutcome } from '#src/queue/workers/internal/common/utils/decideTicketOutcome.ts';
import { readWorkOrderState } from '#src/workOrder/readWorkOrderState.ts';

interface Params {
	step: Omit<WorkOrderPlanStep, 'plan'>;
	/** The work order's label — the folder its record sits in. */
	workOrderName: string;
}

/**
 * A single-plan work order holding no plan 001, built from the ticket body and
 * then decided from the record that build was recorded on.
 *
 * A build already recorded as passed is not built again. Leftover work is
 * neither settled nor parked on here: no plan owns it, so the build runs over
 * whatever the tree holds, as the direct worker always has, and a failed or
 * interrupted earlier build is simply built again.
 */
export const buildPlanlessWorkOrder = async ({ step, workOrderName }: Params): Promise<WorkerOutcome> => {
	const { cwd, record } = step;

	if (record.ticketBodyBuild?.progress === PlanProgress.Implemented) {
		return decideTicketOutcome({ record });
	}

	const built = await buildFromTicketBody({ step });

	if (built.error !== undefined || built.open !== undefined) {
		return built;
	}

	const reread = await readWorkOrderState({ cwd, name: workOrderName });

	if ('error' in reread) {
		return { error: reread.error };
	}

	if (reread.record === undefined) {
		return { error: `work order ${workOrderName} no longer has a record after its build from the ticket body` };
	}

	return decideTicketOutcome({ record: reread.record });
};
