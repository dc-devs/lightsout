import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerTicket } from '#src/ticketTracker/common/types/TrackerTicket.ts';
import type { JiraIssue } from '#src/ticketTracker/jira/common/types/JiraIssue.ts';
import { isFinishedJiraStatus } from '#src/ticketTracker/jira/common/utils/isFinishedJiraStatus.ts';
import { fromAdf } from '#src/ticketTracker/jira/fromAdf.ts';

interface Params {
	issue: JiraIssue;
	/** The configured site origin, stored without a trailing slash. */
	siteUrl: string;
	unfinishedBlockers: string[];
}

const priorities: Readonly<Record<string, number>> = { Highest: 1, High: 2, Medium: 3, Low: 4, Lowest: 5 };

const priorityOf = ({ name }: { name?: string }) => priorities[name ?? ''] ?? 0;

export const toJiraTrackerTicket = ({ issue, siteUrl, unfinishedBlockers }: Params): TrackerTicket | TrackerFailure => {
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

	const categoryKey = issue.fields.status?.statusCategory?.key;

	// A ticket whose finishedness is unknown must never be reported as unfinished:
	// the caller would resume work someone already closed.
	if (categoryKey === undefined) {
		return { error: `Jira issue '${issue.key}' has a status that carries no category` };
	}

	return {
		id: issue.id,
		identifier: issue.key,
		title: issue.fields.summary,
		url: `${siteUrl}/browse/${issue.key}`,
		description,
		priority: priorityOf({ name: issue.fields.priority?.name }),
		createdAt: issue.fields.created,
		labels: issue.fields.labels ?? [],
		status,
		finished: isFinishedJiraStatus({ categoryKey }),
		unfinishedBlockers,
	};
};
