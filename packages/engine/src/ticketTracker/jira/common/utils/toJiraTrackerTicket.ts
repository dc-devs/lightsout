import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerTicket } from '#src/ticketTracker/common/types/TrackerTicket.ts';
import type { JiraIssue } from '#src/ticketTracker/jira/common/types/JiraIssue.ts';
import { fromAdf } from '#src/ticketTracker/jira/fromAdf.ts';

interface Params {
	issue: JiraIssue;
	unfinishedBlockers: string[];
}

const priorities: Readonly<Record<string, number>> = { Highest: 1, High: 2, Medium: 3, Low: 4, Lowest: 5 };

const priorityOf = ({ name }: { name?: string }) => priorities[name ?? ''] ?? 0;

export const toJiraTrackerTicket = ({ issue, unfinishedBlockers }: Params): TrackerTicket | TrackerFailure => {
	const description = fromAdf({ value: issue.fields.description });

	if (description === undefined) {
		return { error: `Jira issue '${issue.key}' has a malformed description` };
	}

	if (issue.fields.summary === undefined || issue.fields.created === undefined) {
		return { error: `Jira issue '${issue.key}' is missing its summary or created value` };
	}

	const status = issue.fields.status?.name;

	if (status === undefined) {
		return { error: `Jira issue '${issue.key}' is missing its status name` };
	}

	return {
		id: issue.id,
		identifier: issue.key,
		title: issue.fields.summary,
		description,
		priority: priorityOf({ name: issue.fields.priority?.name }),
		createdAt: issue.fields.created,
		labels: issue.fields.labels ?? [],
		status,
		unfinishedBlockers,
	};
};
