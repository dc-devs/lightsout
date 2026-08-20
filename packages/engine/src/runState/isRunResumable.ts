import { RunStatus } from '#src/contracts/index.ts';

interface Params {
	status: RunStatus;
	/** Whether a live process stands behind the run — see isRunLive. */
	live: boolean;
}

/**
 * Whether `lightsout resume --run` has work to do.
 *
 * The single definition every consumer reads, so a listing row and a detail
 * header can never disagree about whether a run can be picked up. A `running`
 * run with nothing behind it is a crash leftover and resumable; `escalated` is
 * excluded, because it is waiting on a human decision rather than on a resume.
 */
export const isRunResumable = ({ status, live }: Params): boolean => {
	if (status === RunStatus.Running) {
		return !live;
	}

	return status === RunStatus.Failed || status === RunStatus.PausedRateLimit || status === RunStatus.PausedBudget;
};
