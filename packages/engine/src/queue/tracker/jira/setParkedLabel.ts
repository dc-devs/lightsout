import type { JiraQueueSettings } from '#src/queue/common/types/JiraQueueSettings.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import { runJira } from '#src/queue/tracker/jira/runJira.ts';

interface Params {
	settings: JiraQueueSettings;
	ticketId: string;
	parked: boolean;
}

interface LabelsResponse {
	fields: { labels?: string[] | null };
}

export const setParkedLabel = async ({ settings, ticketId, parked }: Params): Promise<QueueFailure | undefined> => {
	const label = settings.parkedLabel;

	if (label === undefined) {
		return undefined;
	}

	const path = `/rest/api/3/issue/${encodeURIComponent(ticketId)}`;
	const result = await runJira({
		settings,
		request: async (client) => {
			const issue = await client.request<LabelsResponse>({ method: 'GET', path: `${path}?fields=labels`, response: 'json' });
			const labels = issue.fields.labels ?? [];

			if ((parked && labels.includes(label)) || (!parked && !labels.includes(label))) {
				return undefined;
			}

			await client.request({ method: 'PUT', path, body: { update: { labels: [{ [parked ? 'add' : 'remove']: label }] } }, response: 'empty' });
			return undefined;
		},
	});

	return result;
};
