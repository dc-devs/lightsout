import type { Issue } from '@linear/sdk';
import type { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';

interface Params {
	issue: Issue;
	/** Which route this ticket was matched on — the query that returned it, or its label names. */
	route: QueueRoute;
}

/** One tracker issue as the queue's own shape, so no Linear type leaves this folder. */
export const toTicketSummary = ({ issue, route }: Params): TicketSummary => ({
	id: issue.id,
	identifier: issue.identifier,
	title: issue.title,
	description: issue.description ?? '',
	priority: issue.priority,
	createdAt: issue.createdAt.toISOString(),
	route,
});
