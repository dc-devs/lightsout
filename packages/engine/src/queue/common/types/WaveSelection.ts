import type { LeftBehindTicket } from '#src/queue/common/types/LeftBehindTicket.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';

/**
 * One scan of the queue, split by what the drain may do with each ticket.
 *
 * `blocked` is separate from `skipped` because the two have opposite futures: a
 * skipped ticket is settled for this invocation, a blocked one is re-offered by
 * the next scan and may still run in this same drain.
 */
export interface WaveSelection {
	/** Tickets this wave will work, in the order they will be picked up. */
	runnable: TicketSummary[];
	/** Tickets held back until every blocker finishes — re-offered by the next scan. */
	blocked: LeftBehindTicket[];
	/** Tickets settled for good, e.g. the double-label skip. Never re-offered. */
	skipped: LeftBehindTicket[];
}
