import type { JiraQueueSettings } from '#src/queue/common/types/JiraQueueSettings.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import { runJira } from '#src/queue/tracker/jira/runJira.ts';

interface Params {
	settings: JiraQueueSettings;
	ticketId: string;
	statusName: string;
}

interface TransitionsResponse {
	transitions: Array<{ id: string; to: { name: string } }>;
}

export const setTicketStatus = async ({ settings, ticketId, statusName }: Params): Promise<QueueFailure | undefined> => {
	const path = `/rest/api/3/issue/${encodeURIComponent(ticketId)}/transitions`;
	const result = await runJira({
		settings,
		request: async (client) => {
			const transitions = await client.request<TransitionsResponse>({ method: 'GET', path, response: 'json' });
			const transition = transitions.transitions.find((candidate) => candidate.to.name === statusName);

			if (transition === undefined) {
				return { error: `Jira ticket '${ticketId}' has no '${statusName}' transition` };
			}

			await client.request({ method: 'POST', path, body: { transition: { id: transition.id } }, response: 'empty' });
			return undefined;
		},
	});

	return result;
};
