import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { setParkedLabel as setJiraParkedLabel } from '#src/ticketTracker/jira/index.ts';
import { setParkedLabel as setLinearParkedLabel } from '#src/ticketTracker/linear/index.ts';

interface Params {
	settings: TrackerSettings;
	ticketId: string;
	label: string | undefined;
	parked: boolean;
}

export const setParkedLabel = async (params: Params): Promise<TrackerFailure | undefined> =>
	params.settings.provider === 'linear'
		? setLinearParkedLabel({ ...params, settings: params.settings })
		: setJiraParkedLabel({ ...params, settings: params.settings });
