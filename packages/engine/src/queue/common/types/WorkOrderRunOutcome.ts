import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';

/**
 * How one work order's worker ended, and everything the ship step needs from it.
 *
 * There are three cases rather than two: a branch worth merging carries `ready`,
 * a branch the queue left open carries `open`, and anything else is a park.
 * `isParkedOutcome` is the one place that says so, so the parked label, the
 * coordinator status and the exit code can never disagree about an open work
 * order.
 *
 * It is not the branch's recorded phase, and the two answer different
 * questions: a ship-step park flips `ready` while the branch stays recorded
 * ready, so the next run re-ships that branch rather than spending a worker on
 * re-doing finished work.
 */
export interface WorkOrderRunOutcome {
	ticket: TicketSummary;
	/** The branch the worker committed to. */
	branch: string;
	/** Absolute path of the worktree. Removed after a successful ship, kept otherwise. */
	worktreePath: string;
	/** The wave-local "merge this branch in this wave" decision, set from the branch's recorded phase and never re-inferred here. */
	ready: boolean;
	/** Why it stopped. Absent when ready, and absent when the ticket was left open. */
	error?: string;
	/**
	 * Why a multiple-plan work order was left open: it built everything it could, and
	 * its record does not authorize shipping it yet.
	 *
	 * Set only with `ready` false and no `error`. An open ticket is waiting on a
	 * human decision rather than on a re-run, so it takes no parked label, does
	 * not make the command exit 2, and keeps its tracker status.
	 */
	open?: string;
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
