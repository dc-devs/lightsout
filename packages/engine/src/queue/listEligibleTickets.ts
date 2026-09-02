import { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { toRoutedSummaries } from '#src/queue/common/utils/toRoutedSummaries.ts';
import { listTickets, type TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	settings: QueueSettings;
	trackerSettings: TrackerSettings;
}

/**
 * Every ticket the queue may pick up, with the route each one carries.
 *
 * The tracker is asked for the whole configured label set in one query and
 * reports the labels it saw; routing is decided here, because a route is the
 * queue's word for a label and the seam has no business knowing it.
 *
 * A ticket carrying both route labels yields one summary per route,
 * deliberately — the drain is the one place the double-label skip policy lives.
 */
export const listEligibleTickets = async ({ settings, trackerSettings }: Params): Promise<TicketSummary[] | QueueFailure> => {
	const tickets = await listTickets({
		settings: trackerSettings,
		labelNames: Object.values(QueueRoute).map((route) => settings.routeLabels[route]),
		statuses: settings.eligibleStatuses,
	});

	if ('error' in tickets) {
		return tickets;
	}

	return tickets.flatMap((ticket) => toRoutedSummaries({ ticket, routeLabels: settings.routeLabels }));
};
