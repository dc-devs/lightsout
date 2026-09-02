import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { LinearTrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { runLinear } from '#src/ticketTracker/linear/runLinear.ts';

interface Params {
	settings: LinearTrackerSettings;
	ticketId: string;
	statusName: string;
}

export const setTicketStatus = async ({ settings, ticketId, statusName }: Params): Promise<TrackerFailure | undefined> =>
	runLinear({
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
