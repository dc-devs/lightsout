import type { JiraQueueSettings } from '#src/queue/common/types/JiraQueueSettings.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import { addLineUnderHeading } from '#src/queue/tracker/common/utils/addLineUnderHeading.ts';
import { fromAdf } from '#src/queue/tracker/jira/fromAdf.ts';
import { runJira } from '#src/queue/tracker/jira/runJira.ts';
import { toAdf } from '#src/queue/tracker/jira/toAdf.ts';

interface Params {
	settings: JiraQueueSettings;
	ticketId: string;
	heading: string;
	line: string;
}

interface DescriptionResponse {
	fields: { description?: unknown | null };
}

export const appendTicketNote = async ({ settings, ticketId, heading, line }: Params): Promise<QueueFailure | undefined> => {
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
