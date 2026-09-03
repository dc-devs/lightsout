import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { LinearTrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { buildLabelScopeFilter } from '#src/ticketTracker/linear/common/utils/buildLabelScopeFilter.ts';
import { collectNodes } from '#src/ticketTracker/linear/common/utils/collectNodes.ts';
import { runLinear } from '#src/ticketTracker/linear/runLinear.ts';

interface Params {
	settings: LinearTrackerSettings;
}

/**
 * Every label name the configured team may use — its own labels plus the
 * workspace-level ones, which belong to no team.
 *
 * Paged to exhaustion, because a truncated catalog would report a configured
 * label as missing when it exists, and the caller's whole reason for asking is
 * to refuse a configuration that cannot work.
 */
export const listLabelNames = async ({ settings }: Params): Promise<string[] | TrackerFailure> =>
	runLinear({
		apiKey: settings.apiKey,
		call: async (client) => {
			const connection = await client.issueLabels({ filter: { or: buildLabelScopeFilter({ team: settings.team }) } });
			const labels = await collectNodes({ connection });

			return labels.map((label) => label.name);
		},
	});
