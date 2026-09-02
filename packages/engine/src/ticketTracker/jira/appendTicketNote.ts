import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { JiraTrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { addLineUnderHeading } from '#src/ticketTracker/common/utils/addLineUnderHeading.ts';
import { fromAdf } from '#src/ticketTracker/jira/fromAdf.ts';
import { runJira } from '#src/ticketTracker/jira/runJira.ts';
import { toAdf } from '#src/ticketTracker/jira/toAdf.ts';

interface Params {
	settings: JiraTrackerSettings;
	ticketId: string;
	heading: string;
	line: string;
}

interface DescriptionResponse {
	fields: { description?: unknown | null };
}

export const appendTicketNote = async ({ settings, ticketId, heading, line }: Params): Promise<TrackerFailure | undefined> => {
	const path = `/rest/api/3/issue/${encodeURIComponent(ticketId)}`;
	const result = await runJira({
		settings,
		request: async (client) => {
			const issue = await client.request<DescriptionResponse>({ method: 'GET', path: `${path}?fields=description`, response: 'json' });
			const body = fromAdf({ value: issue.fields.description });

			if (body === undefined) {
				return { error: `Jira ticket '${ticketId}' has a malformed description` };
			}

			const markdown = addLineUnderHeading({ body, heading, line });

			await client.request({ method: 'PUT', path, body: { fields: { description: toAdf({ markdown }) } }, response: 'empty' });
			return undefined;
		},
	});

	return result;
};
