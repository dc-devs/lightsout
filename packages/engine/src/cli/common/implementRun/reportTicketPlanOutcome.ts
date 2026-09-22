import type { PipelineResult } from '#src/pipeline/index.ts';
import type { WorkOrderPlanOutcome } from '#src/workOrder/index.ts';

interface Params {
	/** What the ticket lifecycle helper made of the run it wrapped. */
	outcome: WorkOrderPlanOutcome;
}

/**
 * Say what the ticket record made of a wrapped run, and answer the run's own
 * result — or undefined when the record refused to let the run happen at all.
 *
 * `implement` and `resume` both end their run this way, and each of the three
 * messages is a different kind of thing: a refusal means nothing ran and the
 * caller exits 1; a record write that did not take is an error beside a run that
 * did happen; and a pass that covered only part of the plan owes its reader the
 * sentence saying so, which is news rather than a failure.
 *
 * @returns the run's result, or undefined when the ticket record refused the run
 */
export const reportTicketPlanOutcome = ({ outcome }: Params): PipelineResult | undefined => {
	if ('refusal' in outcome) {
		console.error(outcome.refusal);

		return undefined;
	}

	if (outcome.recordError !== undefined) {
		console.error(outcome.recordError);
	}

	if (outcome.note !== undefined) {
		console.log(outcome.note);
	}

	return outcome.result;
};
