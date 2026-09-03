import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { listLabelNames as listJiraLabelNames } from '#src/ticketTracker/jira/index.ts';
import { listLabelNames as listLinearLabelNames } from '#src/ticketTracker/linear/index.ts';

interface Params {
	settings: TrackerSettings;
}

/**
 * Every label name the configured team or project knows about.
 *
 * The answer is complete — every page is walked — because a truncated catalog
 * would report a configured label as missing when it exists, and the caller's
 * whole reason for asking is to refuse a configuration that cannot work.
 *
 * Order is whatever the tracker answered; the caller compares by membership,
 * never by position.
 */
export const listLabelNames = async (params: Params): Promise<string[] | TrackerFailure> =>
	params.settings.provider === 'linear'
		? listLinearLabelNames({ ...params, settings: params.settings })
		: listJiraLabelNames({ ...params, settings: params.settings });
