import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';

/**
 * A parked worktree whose branch is already recorded merged, waiting to be
 * finished.
 *
 * It is carried rather than settled where it is found, because settling it
 * removes a worktree and writes a ticket to Done — main-checkout mutations,
 * which the queue only performs under the run lock the parked scan runs before.
 */
export interface MergedParkedTree {
	/** The queue's own spelling of the path, already re-rooted by the scan. */
	worktreePath: string;
	branch: string;
	ticket: TicketSummary;
}
