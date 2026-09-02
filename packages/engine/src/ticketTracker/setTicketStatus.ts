import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { runLinear } from '#src/ticketTracker/runLinear.ts';

interface Params {
	settings: TrackerSettings;
	/** The ticket's internal id, from `TrackerTicket.id`. */
	ticketId: string;
	statusName: string;
}

/**
 * Move one ticket to a named status, answering undefined when the tracker
 * accepted it — the same convention `pushBranch` uses.
 *
 * A name the team has no workflow state for is a failure naming the status, not
 * a silent no-op: a status nobody can see is a status nobody configured.
 */
export const setTicketStatus = async ({ settings, ticketId, statusName }: Params): Promise<TrackerFailure | undefined> => {
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
