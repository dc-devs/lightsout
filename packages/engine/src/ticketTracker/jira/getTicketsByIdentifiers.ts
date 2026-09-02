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
	identifiers: string[];
}

interface SearchResponse {
	issues: JiraIssue[];
	isLast: boolean;
	nextPageToken?: string;
}

const fields = ['summary', 'description', 'priority', 'created', 'labels', 'status', 'issuelinks'];

const matchingKeys = ({ identifiers, ticketPrefix }: { identifiers: string[]; ticketPrefix: string }) =>
	identifiers.flatMap((identifier) => {
		const [prefix, number] = identifier.split('-');

		return prefix?.toLowerCase() === ticketPrefix.toLowerCase() && /^\d+$/u.test(number ?? '') ? [`${ticketPrefix}-${number}`] : [];
	});

export const getTicketsByIdentifiers = async ({ settings, identifiers }: Params): Promise<TrackerTicket[] | TrackerFailure> => {
	const keys = matchingKeys({ identifiers, ticketPrefix: settings.ticketPrefix });

	if (keys.length === 0) {
		return [];
	}

	return runJira({
		settings,
		request: async (client) => {
			const issues: JiraIssue[] = [];
			let nextPageToken: string | undefined;

			do {
				const jql = `project = ${quoteJqlString({ value: settings.project })} AND key IN (${keys.map((value) => quoteJqlString({ value })).join(', ')})`;
				const body = nextPageToken === undefined ? { jql, fields } : { jql, fields, nextPageToken };
				const page = await client.request<SearchResponse>({ method: 'POST', path: '/rest/api/3/search/jql', body, response: 'json' });

				issues.push(...page.issues);

				if (!page.isLast && page.nextPageToken === undefined) {
					return { error: 'Jira returned a nonfinal search page without a nextPageToken' };
				}

				nextPageToken = page.isLast ? undefined : page.nextPageToken;
			} while (nextPageToken !== undefined);

			const tickets: TrackerTicket[] = [];

			for (const issue of issues) {
				const ticket = toJiraTrackerTicket({ issue, unfinishedBlockers: getJiraUnfinishedBlockers({ issue }) });

				if ('error' in ticket) {
					return ticket;
				}

				tickets.push(ticket);
			}

			return tickets;
		},
	});
};
