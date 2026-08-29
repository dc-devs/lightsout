import type { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';

/**
 * One ticket, reduced to what the queue actually uses.
 *
 * The tracker adapter builds these; nothing outside `queue/tracker/` ever sees
 * a tracker's own type, which is what keeps swapping trackers a change inside
 * that folder alone.
 */
export interface TicketSummary {
	/** The tracker's internal id — what every write call takes. */
	id: string;
	/** The human reference, e.g. 'LO-70'. */
	identifier: string;
	title: string;
	/** The ticket body as markdown. Empty string when the ticket has none. */
	description: string;
	/** Linear's priority scale: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
	priority: number;
	/** ISO timestamp — the tiebreak within a priority. */
	createdAt: string;
	/** Which route label this ticket carried. */
	route: QueueRoute;
}
