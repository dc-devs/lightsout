import type { LinearQueueSettings } from '#src/queue/common/types/LinearQueueSettings.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import { runLinear } from '#src/queue/tracker/runLinear.ts';

interface Params {
	settings: LinearQueueSettings;
	ticketId: string;
	statusName: string;
}

export const setTicketStatus = async ({ settings, ticketId, statusName }: Params): Promise<QueueFailure | undefined> => {
	const applied = await runLinear({
		apiKey: settings.apiKey,
		call: async (client) => {
			const states = await client.workflowStates({ filter: { team: { key: { eq: settings.team } }, name: { eq: statusName } } });
			const state = states.nodes.at(0);

			if (state === undefined) {
				return { error: `the '${settings.team}' team has no '${statusName}' status` };
			}

			await client.updateIssue(ticketId, { stateId: state.id });
			return undefined;
		},
	});

	return applied;
};
