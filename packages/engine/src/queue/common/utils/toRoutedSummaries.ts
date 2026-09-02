import { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { TrackerTicket } from '#src/ticketTracker/index.ts';

interface Params {
	ticket: TrackerTicket;
	/** The ticket label naming each route, from the resolved queue settings. */
	routeLabels: Record<QueueRoute, string>;
}

/**
 * One summary per configured route label the ticket carries.
 *
 * A ticket whose route labels were all removed yields none — the caller reads
 * that as the user withdrawing the automation. A ticket carrying two yields
 * two, so the drain's double-label skip sees a resumed ticket exactly as it
 * sees one from the eligible list.
 */
export const toRoutedSummaries = ({ ticket, routeLabels }: Params): TicketSummary[] =>
	Object.values(QueueRoute)
		.filter((route) => ticket.labels.includes(routeLabels[route]))
		.map((route) => ({ ...ticket, route }));
