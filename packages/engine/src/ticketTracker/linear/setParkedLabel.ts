import type { LinearClient } from '@linear/sdk';
import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { LinearTrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { runLinear } from '#src/ticketTracker/linear/runLinear.ts';

interface Params {
	settings: LinearTrackerSettings;
	ticketId: string;
	label: string | undefined;
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

export const setParkedLabel = async ({ settings, ticketId, label, parked }: Params): Promise<TrackerFailure | undefined> => {
	if (label === undefined) {
		return undefined;
	}

	return runLinear({
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
};
