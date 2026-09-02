import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { JiraTrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { runJira } from '#src/ticketTracker/jira/runJira.ts';

interface Params {
	settings: JiraTrackerSettings;
	ticketId: string;
	label: string | undefined;
	parked: boolean;
}

interface LabelsResponse {
	fields: { labels?: string[] | null };
}

export const setParkedLabel = async ({ settings, ticketId, label, parked }: Params): Promise<TrackerFailure | undefined> => {
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
