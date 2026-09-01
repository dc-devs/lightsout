import type { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { JiraIssue } from '#src/queue/tracker/jira/common/types/JiraIssue.ts';
import { fromAdf } from '#src/queue/tracker/jira/fromAdf.ts';

interface Params {
	issue: JiraIssue;
	route: QueueRoute;
	unfinishedBlockers: string[];
}

const priorities: Readonly<Record<string, number>> = { Highest: 1, High: 2, Medium: 3, Low: 4, Lowest: 5 };

const priorityOf = ({ name }: { name?: string }) => priorities[name ?? ''] ?? 0;

export const toJiraTicketSummary = ({ issue, route, unfinishedBlockers }: Params): TicketSummary | QueueFailure => {
	const description = fromAdf({ value: issue.fields.description });

	if (description === undefined) {
		return { error: `Jira issue '${issue.key}' has a malformed description` };
	}

	if (issue.fields.summary === undefined || issue.fields.created === undefined) {
		return { error: `Jira issue '${issue.key}' is missing its summary or created value` };
	}

	return {
		id: issue.id,
		identifier: issue.key,
		title: issue.fields.summary,
		description,
		priority: priorityOf({ name: issue.fields.priority?.name }),
		createdAt: issue.fields.created,
		route,
		unfinishedBlockers,
	};
};
