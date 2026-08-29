import type { LinearClient } from '@linear/sdk';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import { runLinear } from '#src/queue/tracker/runLinear.ts';

interface Params {
	settings: QueueSettings;
	/** The ticket's internal id, from `TicketSummary.id`. */
	ticketId: string;
	/** true when the ticket has just parked, false when it resumed or shipped. */
	parked: boolean;
}

/** The team's label, created here on first use so adopting `parked-label` is setup nobody has to do by hand. */
const createTeamLabel = async ({ client, team, label }: { client: LinearClient; team: string; label: string }) => {
	const teams = await client.teams({ filter: { key: { eq: team } } });
	const teamId = teams.nodes.at(0)?.id;

	if (teamId === undefined) {
		return { error: `there is no '${team}' team to create the '${label}' label on` };
	}

	const created = await client.createIssueLabel({ name: label, teamId });

	// The payload carries the new id, so the label is usable without a second
	// round trip to look up what was just written.
	return created.issueLabelId ?? { error: `the tracker created the '${label}' label but named no id for it` };
};

/**
 * Put the configured parked label on a ticket, or take it off.
 *
 * A no-op when no `parked-label` is configured: the label is opt-in, and a repo
 * that never named one must never have one invented for it.
 *
 * The label is created on the team on first use, because a stale parked label
 * is worse than none and asking a user to pre-create one is setup they did not
 * agree to.
 */
export const setParkedLabel = async ({ settings, ticketId, parked }: Params): Promise<QueueFailure | undefined> => {
	const label = settings.parkedLabel;

	if (label === undefined) {
		return undefined;
	}

	const written = await runLinear({
		apiKey: settings.apiKey,
		call: async (client) => {
			const labels = await client.issueLabels({ filter: { name: { eq: label }, team: { key: { eq: settings.team } } } });
			const existing = labels.nodes.at(0);

			if (existing === undefined && !parked) {
				return undefined;
			}

			const labelId = existing?.id ?? (await createTeamLabel({ client, team: settings.team, label }));

			if (typeof labelId !== 'string') {
				return labelId;
			}

			await (parked ? client.issueAddLabel(ticketId, labelId) : client.issueRemoveLabel(ticketId, labelId));

			return undefined;
		},
	});

	return written;
};
