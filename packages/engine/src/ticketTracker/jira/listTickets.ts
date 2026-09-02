import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { JiraTrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import type { TrackerTicket } from '#src/ticketTracker/common/types/TrackerTicket.ts';
import type { JiraIssue } from '#src/ticketTracker/jira/common/types/JiraIssue.ts';
import { getJiraUnfinishedBlockers } from '#src/ticketTracker/jira/common/utils/getJiraUnfinishedBlockers.ts';
import { quoteJqlString } from '#src/ticketTracker/jira/common/utils/quoteJqlString.ts';
import { toJiraTrackerTicket } from '#src/ticketTracker/jira/common/utils/toJiraTrackerTicket.ts';
import { runJira } from '#src/ticketTracker/jira/runJira.ts';

interface Params {
	settings: JiraTrackerSettings;
	labelNames: string[];
	statuses: string[];
}

interface SearchResponse {
	issues: JiraIssue[];
	isLast: boolean;
	nextPageToken?: string;
}

const fields = ['summary', 'description', 'priority', 'created', 'labels', 'status', 'issuelinks'];

export const listTickets = async ({ settings, labelNames, statuses }: Params): Promise<TrackerTicket[] | TrackerFailure> => {
	if (labelNames.length === 0 || statuses.length === 0) {
		return [];
	}

	return runJira({
		settings,
		request: async (client) => {
			const tickets: TrackerTicket[] = [];
			let nextPageToken: string | undefined;

			do {
				const jql = [
					`project = ${quoteJqlString({ value: settings.project })}`,
					`labels IN (${labelNames.map((value) => quoteJqlString({ value })).join(', ')})`,
					`status IN (${statuses.map((value) => quoteJqlString({ value })).join(', ')})`,
				].join(' AND ');
				const body = nextPageToken === undefined ? { jql, fields } : { jql, fields, nextPageToken };
				const page = await client.request<SearchResponse>({ method: 'POST', path: '/rest/api/3/search/jql', body, response: 'json' });

				for (const issue of page.issues) {
					const ticket = toJiraTrackerTicket({ issue, unfinishedBlockers: getJiraUnfinishedBlockers({ issue }) });

					if ('error' in ticket) {
						return ticket;
					}

					tickets.push(ticket);
				}

				if (!page.isLast && page.nextPageToken === undefined) {
					return { error: 'Jira returned a nonfinal search page without a nextPageToken' };
				}

				nextPageToken = page.isLast ? undefined : page.nextPageToken;
			} while (nextPageToken !== undefined);

			return tickets;
		},
	});
};
