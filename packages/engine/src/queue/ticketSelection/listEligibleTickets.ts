import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { toPlanningSummaries } from '#src/queue/common/utils/toPlanningSummaries.ts';
import { listTickets, type TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	settings: QueueSettings;
	trackerSettings: TrackerSettings;
}

/**
 * Every ticket the queue may pick up, with the planning status each one carries
 * and the worker its pair selects.
 *
 * The tracker is asked for the whole configured label set in one query and
 * reports the labels and the status it saw; what they mean is decided here,
 * because a planning status is the queue's word for a label and the seam has no
 * business knowing it.
 *
 * A ticket carrying more than one planning-status label yields one summary per
 * status, deliberately — the drain is the one place the ambiguity skip lives.
 */
export const listEligibleTickets = async ({ settings, trackerSettings }: Params): Promise<TicketSummary[] | QueueFailure> => {
	const tickets = await listTickets({
		settings: trackerSettings,
		labelNames: Object.values(PlanningStatus).map((status) => settings.lifecycle.planningStatusLabels[status]),
		statuses: settings.lifecycle.eligibleStatuses,
	});

	if ('error' in tickets) {
		return tickets;
	}

	return tickets.flatMap((ticket) => toPlanningSummaries({ ticket, lifecycle: settings.lifecycle, resumed: false }));
};
