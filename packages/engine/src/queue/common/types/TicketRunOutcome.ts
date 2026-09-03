import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';

/**
 * How one ticket's worker ended, and everything the ship step needs from it.
 *
 * `ready` is the whole distinction between a branch worth merging and a parked
 * one, so there is no string discriminant to narrow on.
 *
 * It is not the branch's recorded phase, and the two answer different
 * questions: a ship-step park flips `ready` while the branch stays recorded
 * ready, so the next run re-ships that branch rather than spending a worker on
 * re-doing finished work.
 */
export interface TicketRunOutcome {
	ticket: TicketSummary;
	/** The branch the worker committed to. */
	branch: string;
	/** Absolute path of the worktree. Removed after a successful ship, kept otherwise. */
	worktreePath: string;
	/** The wave-local "merge this branch in this wave" decision, set from the branch's recorded phase and never re-inferred here. */
	ready: boolean;
	/** Why it stopped. Absent when ready. */
	error?: string;
	/** True when the stop was a question nobody answered — the drain retires that ticket's slot instead of refilling it. */
	unanswered?: boolean;
	/**
	 * Why the ticket's tracker state could not be reconciled after its merge.
	 *
	 * Separate from `error` and never paired with a flipped `ready`: a tracker
	 * failure cannot undo a confirmed merge, and reusing the ready flag would
	 * park a branch that is already merged and send the next drain to re-ship
	 * it. The drain report prints it beside the shipped line.
	 */
	reconciliationFailure?: string;
}
