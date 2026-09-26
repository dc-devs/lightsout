import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import type { AuthorPhaseFilesResult } from '#src/plan/draft/internal/common/types/AuthorPhaseFilesResult.ts';
import type { createDraftStop } from '#src/plan/draft/internal/common/utils/createDraftStop.ts';
import type { RunPlanDraftResult } from '#src/plan/internal/common/types/RunPlanDraftResult.ts';

/** The fan-out statuses that end the draft, so the caller narrows to the complete one by taking this branch. */
type FailedPhases = Exclude<AuthorPhaseFilesResult, { status: typeof PlanRunStatus.Complete }>;

interface Params {
	phases: FailedPhases;
	draftStop: ReturnType<typeof createDraftStop>;
}

/**
 * Turn a fan-out that did not complete into the draft's stop, carrying each
 * status's own fields across.
 *
 * Shared by both phased flows: the three non-complete fan-out statuses map onto
 * the three draft stops one-for-one, so the mapping is bookkeeping rather than
 * policy, and a second copy of it is a place for a fourth status to be forgotten
 * in one implementation and not the other.
 */
export const stopForPhaseFailure = ({ phases, draftStop }: Params): RunPlanDraftResult => {
	let stop: RunPlanDraftResult;

	if (phases.status === PlanRunStatus.FactsError) {
		stop = draftStop({ status: PlanRunStatus.FactsError, discrepancies: phases.discrepancies });
	} else if (phases.status === PlanRunStatus.PausedRateLimit) {
		stop = draftStop({ status: PlanRunStatus.PausedRateLimit, error: phases.error });
	} else {
		stop = draftStop({ status: PlanRunStatus.Failed, error: phases.error });
	}

	return stop;
};
