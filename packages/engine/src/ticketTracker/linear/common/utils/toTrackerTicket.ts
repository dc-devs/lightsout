import type { Issue } from '@linear/sdk';
import type { TrackerTicket } from '#src/ticketTracker/common/types/TrackerTicket.ts';

interface Params {
	issue: Issue;
	/** Every label name the issue carries, already resolved by the caller. */
	labels: string[];
	/** The issue's workflow status name, already resolved by the caller. */
	status: string;
	/** Identifiers of this ticket's unfinished blockers, already resolved by the caller. */
	unfinishedBlockers: string[];
}

/** One tracker issue as this module's own shape, so no Linear type leaves the folder. */
export const toTrackerTicket = ({ issue, labels, status, unfinishedBlockers }: Params): TrackerTicket => ({
	id: issue.id,
	identifier: issue.identifier,
	title: issue.title,
	description: issue.description ?? '',
	priority: issue.priority,
	createdAt: issue.createdAt.toISOString(),
	labels,
	status,
	unfinishedBlockers,
});
