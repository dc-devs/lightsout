import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { LinearTrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import type { TrackerTicket } from '#src/ticketTracker/common/types/TrackerTicket.ts';
import { collectTrackerTickets } from '#src/ticketTracker/linear/common/utils/collectTrackerTickets.ts';
import { runLinear } from '#src/ticketTracker/linear/runLinear.ts';

interface Params {
	settings: LinearTrackerSettings;
	/** Label names to match — an issue carrying any one of them is returned once. */
	labelNames: string[];
	/** Workflow-state names a ticket may be in to be returned. */
	statuses: string[];
}

/**
 * Every ticket carrying one of the named labels and sitting at one of the named
 * statuses, with the labels each one actually carries.
 *
 * One query for the whole label set rather than one per label: a ticket
 * carrying two of them comes back once, and the caller can see both names —
 * which is what lets a caller decide what a second label means instead of
 * guessing from which query answered.
 *
 * A failure is returned rather than swallowed, so a bad key or an unreachable
 * API stops the caller instead of reading as an empty backlog.
 *
 * Each returned issue costs one round trip for its labels, one for its
 * relations and one per blocking relation, all inside the same 60s tracker
 * deadline: Linear's issue filter cannot express "has an unfinished blocker",
 * and the blocker identifiers are needed for the report either way.
 */
export const listTickets = async ({ settings, labelNames, statuses }: Params): Promise<TrackerTicket[] | TrackerFailure> => {
	if (labelNames.length === 0 || statuses.length === 0) {
		return [];
	}

	return runLinear({
		apiKey: settings.apiKey,
		call: async (client) => {
			const connection = await client.issues({
				filter: {
					team: { key: { eq: settings.team } },
					labels: { name: { in: labelNames } },
					state: { name: { in: statuses } },
				},
			});

			return collectTrackerTickets({ connection });
		},
	});
};
