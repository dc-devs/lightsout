import { RefactorStepReport, type StepRecord } from '#src/contracts/index.ts';
import type { CleanupSummary } from '#src/runState/common/types/CleanupSummary.ts';

interface Params {
	step: StepRecord;
}

/**
 * One step's cleanup outcome as every surface prints it, or undefined when the
 * step recorded none.
 *
 * The contract decides, never the step id: a coordinator step whose report is a
 * `PhaseReport`, and a step the run never reached, both answer undefined rather
 * than a zeroed summary — a cleanup line claiming zero rounds would read as a
 * pass that ran and found nothing, which is a different fact.
 *
 * Counts, never the findings themselves: the step record is where an inspector
 * opens them, and a report card carrying thousands of entries would be one
 * every surface has to cut back down.
 */
export const buildCleanupSummary = ({ step }: Params): CleanupSummary | undefined => {
	const parsed = RefactorStepReport.safeParse(step.report);
	let summary: CleanupSummary | undefined;

	if (parsed.success) {
		const { roundsUsed, endReason, remaining, inherited, uncertain, finalReview, failures } = parsed.data;

		summary = {
			rounds: roundsUsed,
			endReason,
			remainingFindings: remaining.length,
			carriedFindings: inherited.length + uncertain.length,
			reviewFindings: finalReview.length,
			failures: failures.length,
		};
	}

	return summary;
};
