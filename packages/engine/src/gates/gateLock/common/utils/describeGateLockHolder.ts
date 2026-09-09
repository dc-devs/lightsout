import type { GateLock } from '#src/contracts/index.ts';

interface Params {
	/** The reservation on disk, or undefined when it could not be read or parsed. */
	lock: GateLock | undefined;
}

/**
 * The phrase naming who holds the machine — the run, the worktree it runs in,
 * and how long it has held the reservation.
 *
 * Written once and reused by the waiting line and the refusal sentence alike,
 * following the rule `describeGateCrash` established: one event gets one
 * spelling, because two spellings read as two different events. A document that
 * could not be read says so rather than inventing a holder.
 */
export const describeGateLockHolder = ({ lock }: Params): string => {
	if (lock === undefined) {
		return 'another gate run whose reservation on this machine could not be read';
	}

	const heldMs = Date.now() - Date.parse(lock.startedAt);

	return `run ${lock.runId} in ${lock.worktree}, which has held it for ${Math.floor(heldMs / 60_000)}m ${Math.floor((heldMs % 60_000) / 1_000)}s`;
};
