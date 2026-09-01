import { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { JiraQueueSettings } from '#src/queue/common/types/JiraQueueSettings.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { JiraIssue } from '#src/queue/tracker/jira/common/types/JiraIssue.ts';
import { getJiraUnfinishedBlockers } from '#src/queue/tracker/jira/common/utils/getJiraUnfinishedBlockers.ts';
import { quoteJqlString } from '#src/queue/tracker/jira/common/utils/quoteJqlString.ts';
import { toJiraTicketSummary } from '#src/queue/tracker/jira/common/utils/toJiraTicketSummary.ts';
import { runJira } from '#src/queue/tracker/jira/runJira.ts';

interface Params {
	settings: JiraQueueSettings;
}

interface SearchResponse {
	issues: JiraIssue[];
	isLast: boolean;
	nextPageToken?: string;
}

export const listEligibleTickets = async ({ settings }: Params): Promise<TicketSummary[] | QueueFailure> => {
	if (settings.eligibleStatuses.length === 0) {
		return [];
	}

	const fields = ['summary', 'description', 'priority', 'created', 'labels', 'status', 'issuelinks'];

	return runJira({
		settings,
		request: async (client) => {
			const result: TicketSummary[] = [];

			for (const route of Object.values(QueueRoute)) {
				let nextPageToken: string | undefined;

				do {
					const jql = [
						`project = ${quoteJqlString({ value: settings.project })}`,
						`labels = ${quoteJqlString({ value: settings.routeLabels[route] })}`,
						`status IN (${settings.eligibleStatuses.map((value) => quoteJqlString({ value })).join(', ')})`,
					].join(' AND ');
					const body = nextPageToken === undefined ? { jql, fields } : { jql, fields, nextPageToken };
					const page = await client.request<SearchResponse>({ method: 'POST', path: '/rest/api/3/search/jql', body, response: 'json' });

					for (const issue of page.issues) {
						const summary = toJiraTicketSummary({ issue, route, unfinishedBlockers: getJiraUnfinishedBlockers({ issue }) });

						if ('error' in summary) {
							return summary;
						}

						result.push(summary);
					}

					if (!page.isLast && page.nextPageToken === undefined) {
						return { error: 'Jira returned a nonfinal search page without a nextPageToken' };
					}

					nextPageToken = page.isLast ? undefined : page.nextPageToken;
				} while (nextPageToken !== undefined);
			}

			return result;
		},
	});
};
