import type { Connection, Issue } from '@linear/sdk';
import type { TrackerTicket } from '#src/ticketTracker/common/types/TrackerTicket.ts';
import { collectNodes } from '#src/ticketTracker/common/utils/collectNodes.ts';
import { getUnfinishedBlockers } from '#src/ticketTracker/common/utils/getUnfinishedBlockers.ts';
import { readLabelNames } from '#src/ticketTracker/common/utils/readLabelNames.ts';
import { toTrackerTicket } from '#src/ticketTracker/common/utils/toTrackerTicket.ts';

interface Params {
	/** The first page of issues, as the client answered it. */
	connection: Connection<Issue>;
}

/**
 * Every issue an answered query names, paged to exhaustion and turned into this
 * module's own shape.
 *
 * Both reads in this module — the label-filtered list and the
 * identifier-filtered lookup — differ only in the filter they ask for; what
 * happens to the answer is one thing, so it is written once. The labels and the
 * blockers of one issue are independent round trips, so they are resolved
 * together rather than one after the other.
 */
export const collectTrackerTickets = async ({ connection }: Params): Promise<TrackerTicket[]> => {
	const issues = await collectNodes({ connection });

	return Promise.all(
		issues.map(async (issue) => {
			const [labels, unfinishedBlockers] = await Promise.all([readLabelNames({ issue }), getUnfinishedBlockers({ issue })]);

			return toTrackerTicket({ issue, labels, unfinishedBlockers });
		}),
	);
};
