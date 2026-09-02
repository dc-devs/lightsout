import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { LinearTrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import type { TrackerTicket } from '#src/ticketTracker/common/types/TrackerTicket.ts';
import { collectTrackerTickets } from '#src/ticketTracker/linear/common/utils/collectTrackerTickets.ts';
import { runLinear } from '#src/ticketTracker/linear/runLinear.ts';

interface Params {
	settings: LinearTrackerSettings;
	/** Human references, e.g. ['LO-70', 'LO-71'] — matched case-insensitively. */
	identifiers: string[];
}

/** The issue numbers an identifier list names: the trailing dash-separated segment read as a number, e.g. 'LO-70' → 70. An identifier with no number to read is dropped. */
const readIssueNumbers = ({ identifiers, ticketPrefix }: { identifiers: string[]; ticketPrefix: string }) =>
	identifiers.flatMap((identifier) => {
		const [prefix, number] = identifier.split('-');

		return prefix?.toLowerCase() === ticketPrefix.toLowerCase() && /^\d+$/u.test(number ?? '') ? [Number(number)] : [];
	});

/**
 * The resume path's lookup: these exact tickets, fetched with NO status filter.
 *
 * A ticket parked mid-drain sits at the in-progress status, which is exactly
 * what a status-filtered list hides — so the worktree directory is the durable
 * record of parked work, and this is how its tickets are read back.
 *
 * One ticket per issue, never one per label: the labels come back as they are
 * and the caller is the one place they mean anything.
 */
export const getTicketsByIdentifiers = async ({ settings, identifiers }: Params): Promise<TrackerTicket[] | TrackerFailure> => {
	const issueNumbers = readIssueNumbers({ identifiers, ticketPrefix: settings.ticketPrefix });

	if (issueNumbers.length === 0) {
		return [];
	}

	return runLinear({
		apiKey: settings.apiKey,
		call: async (client) => {
			const connection = await client.issues({ filter: { team: { key: { eq: settings.team } }, number: { in: issueNumbers } } });

			return collectTrackerTickets({ connection });
		},
	});
};
