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
	identifiers: string[];
}

interface SearchResponse {
	issues: JiraIssue[];
	isLast: boolean;
	nextPageToken?: string;
}

export const getTicketsByIdentifiers = async ({ settings, identifiers }: Params): Promise<TicketSummary[] | QueueFailure> => {
	const keys = identifiers.filter((identifier) => identifier.startsWith(`${settings.project}-`));

	if (keys.length === 0) {
		return [];
	}

	const fields = ['summary', 'description', 'priority', 'created', 'labels', 'status', 'issuelinks'];

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

			const summaries: TicketSummary[] = [];

			for (const issue of issues) {
				const labels = new Set(issue.fields.labels ?? []);

				for (const route of Object.values(QueueRoute).filter((route) => labels.has(settings.routeLabels[route]))) {
					const summary = toJiraTicketSummary({ issue, route, unfinishedBlockers: getJiraUnfinishedBlockers({ issue }) });

					if ('error' in summary) {
						return summary;
					}

					summaries.push(summary);
				}
			}

			return summaries;
		},
	});
};
