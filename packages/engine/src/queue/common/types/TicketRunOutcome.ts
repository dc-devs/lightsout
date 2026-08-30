import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';

/**
 * How one ticket's worker ended, and everything the ship step needs from it.
 *
 * `ready` is the whole distinction between a branch worth merging and a parked
 * one, so there is no string discriminant to narrow on.
 */
export interface TicketRunOutcome {
	ticket: TicketSummary;
	/** The branch the worker committed to. */
	branch: string;
	/** Absolute path of the worktree. Removed after a successful ship, kept otherwise. */
	worktreePath: string;
	/** True when the work is committed and the gates were green — the ship step's entry condition. */
	ready: boolean;
	/** Why it stopped. Absent when ready. */
	error?: string;
	/** True when the stop was a question nobody answered — the drain retires that ticket's slot instead of refilling it. */
	unanswered?: boolean;
}
