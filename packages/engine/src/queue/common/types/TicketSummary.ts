import type { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { TrackerTicket } from '#src/ticketTracker/index.ts';

/**
 * One ticket the queue is working, which is a tracker ticket plus the route its
 * labels resolved to.
 *
 * The seam builds the `TrackerTicket`; `toRoutedSummaries` is the one place a
 * label becomes a route.
 */
export interface TicketSummary extends TrackerTicket {
	/** Which route label this ticket carried. */
	route: QueueRoute;
}
