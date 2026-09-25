import type { PipelineResult } from '#src/pipeline/PipelineResult.ts';
import type { WorkerOutcome } from '#src/queue/internal/common/types/WorkerOutcome.ts';
import type { WorkOrderPlanOutcome } from '#src/workOrder/common/types/WorkOrderPlanOutcome.ts';

interface Params {
	outcome: WorkOrderPlanOutcome;
	/** States a run that did not pass: `stated` is the run's own sentence, or how it ended when it gave none. */
	onFailedRun: (params: { stated: string; result: PipelineResult }) => WorkerOutcome;
}

/**
 * A work order lifecycle helper's answer read back in the queue's three terms.
 *
 * A refusal and a passed run read the same for every worker — a record write
 * that failed after a pass parks the ticket, because the ship check reads the
 * record — so only what a failed run tells the human differs per caller.
 */
export const toWorkerOutcome = ({ outcome, onFailedRun }: Params): WorkerOutcome => {
	if ('refusal' in outcome) {
		return { error: outcome.refusal };
	}

	const { result, recordError } = outcome;

	if (result.ok) {
		return recordError === undefined ? {} : { error: recordError };
	}

	return onFailedRun({ stated: result.error ?? `the run ended ${result.manifest.status}`, result });
};
