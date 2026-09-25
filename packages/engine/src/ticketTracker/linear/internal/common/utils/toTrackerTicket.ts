import type { Issue } from '@linear/sdk';
import type { TrackerTicket } from '#src/ticketTracker/common/types/TrackerTicket.ts';

interface Params {
	issue: Issue;
	labels: string[];
	status: string;
	finished: boolean;
	unfinishedBlockers: string[];
}

/**
 * One tracker issue as this module's own shape, so no Linear type leaves the folder.
 *
 * This mapper resolves nothing itself: the labels, status, finishedness and
 * blockers are the caller's round trips, already made before it is called.
 */
export const toTrackerTicket = ({ issue, labels, status, finished, unfinishedBlockers }: Params): TrackerTicket => ({
	id: issue.id,
	identifier: issue.identifier,
	title: issue.title,
	url: issue.url,
	description: issue.description ?? '',
	priority: issue.priority,
	createdAt: issue.createdAt.toISOString(),
	labels,
	status,
	finished,
	unfinishedBlockers,
});
