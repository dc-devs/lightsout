import type { Connection, Issue } from '@linear/sdk';
import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerTicket } from '#src/ticketTracker/common/types/TrackerTicket.ts';
import { collectNodes } from '#src/ticketTracker/linear/common/utils/collectNodes.ts';
import { getUnfinishedBlockers } from '#src/ticketTracker/linear/common/utils/getUnfinishedBlockers.ts';
import { readLabelNames } from '#src/ticketTracker/linear/common/utils/readLabelNames.ts';
import { toTrackerTicket } from '#src/ticketTracker/linear/common/utils/toTrackerTicket.ts';

interface Params {
	/** The first page of issues, as the client answered it. */
	connection: Connection<Issue>;
}

const isFailure = (entry: TrackerTicket | TrackerFailure): entry is TrackerFailure => 'error' in entry;

/**
 * Every issue an answered query names, paged to exhaustion and turned into this
 * module's own shape.
 *
 * Both reads in this module — the label-filtered list and the
 * identifier-filtered lookup — differ only in the filter they ask for; what
 * happens to the answer is one thing, so it is written once. The labels, the
 * blockers and the workflow state of one issue are independent round trips, so
 * they are resolved together rather than one after the other.
 *
 * An issue whose workflow state cannot be read fails the whole read rather than
 * reporting an empty status: an empty status matches none of a caller's
 * selectable pairs, so it would silently drop the ticket from the backlog — and
 * a silently smaller backlog is the one wrong answer this function already
 * refuses to give when it pages to exhaustion.
 */
export const collectTrackerTickets = async ({ connection }: Params): Promise<TrackerTicket[] | TrackerFailure> => {
	const issues = await collectNodes({ connection });
	const resolved = await Promise.all(
		issues.map(async (issue): Promise<TrackerTicket | TrackerFailure> => {
			const [labels, unfinishedBlockers, state] = await Promise.all([readLabelNames({ issue }), getUnfinishedBlockers({ issue }), issue.state]);

			return state === undefined
				? { error: `Linear issue '${issue.identifier}' has no readable workflow status` }
				: toTrackerTicket({ issue, labels, status: state.name, unfinishedBlockers });
		}),
	);
	const failure = resolved.find(isFailure);

	return failure ?? resolved.filter((entry): entry is TrackerTicket => !isFailure(entry));
};
