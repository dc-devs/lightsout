import type { LinearClient } from '@linear/sdk';
import type { LinearQueueSettings } from '#src/queue/common/types/LinearQueueSettings.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import { runLinear } from '#src/queue/tracker/runLinear.ts';

interface Params {
	settings: LinearQueueSettings;
	ticketId: string;
	parked: boolean;
}

const createTeamLabel = async ({ client, team, label }: { client: LinearClient; team: string; label: string }) => {
	const teams = await client.teams({ filter: { key: { eq: team } } });
	const teamId = teams.nodes.at(0)?.id;

	if (teamId === undefined) {
		return { error: `there is no '${team}' team to create the '${label}' label on` };
	}

	const created = await client.createIssueLabel({ name: label, teamId });

	return created.issueLabelId ?? { error: `the tracker created the '${label}' label but named no id for it` };
};

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
