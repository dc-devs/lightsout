import type { LeftBehindTicket } from '#src/queue/common/types/LeftBehindTicket.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';

/** What an earlier drain left on disk, sorted by what each worktree still needs. */
export interface ParkedWork {
	/** Tickets whose worktree still has work in it — they re-enter the drain ahead of every new ticket. */
	resumed: TicketSummary[];
	/** Worktrees that skip the drain: committed and clean ones headed straight for the merge, and ones that could not be read at all. */
	outcomes: TicketRunOutcome[];
	/** Worktrees nothing could be done with, and why — a stray tree, or a ticket whose route label was removed. */
	leftBehind: LeftBehindTicket[];
}
