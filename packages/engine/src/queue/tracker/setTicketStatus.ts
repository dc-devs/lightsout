import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import { runLinear } from '#src/queue/tracker/runLinear.ts';

interface Params {
	settings: QueueSettings;
	/** The ticket's internal id, from `TicketSummary.id`. */
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
