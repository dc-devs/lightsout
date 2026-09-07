import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import { listLabelNames, type TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	settings: QueueSettings;
	trackerSettings: TrackerSettings;
}

/** How a user makes a missing label exist, which is not the same action on the two trackers. */
const describeFix = ({ provider, missing }: { provider: TrackerSettings['provider']; missing: string[] }) =>
	provider === 'linear'
		? `create ${missing.length === 1 ? 'it' : 'them'} on the team`
		: // A Jira label comes into being the first time an issue carries it, so
			// there is no create-a-label action to name.
			`apply ${missing.length === 1 ? 'it' : 'each of them'} to any issue in the project`;

/**
 * The one refusal a queue owes a repository whose configured planning-status
 * labels do not all exist on its tracker.
 *
 * It runs at startup, before any ticket is picked up, because a ticket needing
 * a label the tracker has never heard of would otherwise be omitted in silence.
 * Only the expected labels are checked: nothing here knows any historical
 * spelling.
 */
export const checkPlanningStatusLabels = async ({ settings, trackerSettings }: Params): Promise<QueueFailure | undefined> => {
	const known = await listLabelNames({ settings: trackerSettings });

	if ('error' in known) {
		return known;
	}

	const missing = Object.values(PlanningStatus)
		.map((status) => settings.lifecycle.planningStatusLabels[status])
		.filter((label) => !known.includes(label));

	if (missing.length === 0) {
		return undefined;
	}

	const named = missing.map((label) => `'${label}'`).join(', ');

	return {
		error: `the tracker has no ${missing.length === 1 ? 'label' : 'labels'} ${named}, which \`queue.planning-status-labels\` names — ${describeFix({ provider: trackerSettings.provider, missing })}, or name the labels this tracker already has`,
	};
};
