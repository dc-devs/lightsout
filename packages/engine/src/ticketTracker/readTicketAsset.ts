import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { readTicketAsset as readJiraTicketAsset } from '#src/ticketTracker/jira/index.ts';
import { readTicketAsset as readLinearTicketAsset } from '#src/ticketTracker/linear/index.ts';

interface Params {
	settings: TrackerSettings;
	url: string;
}

export const readTicketAsset = async (params: Params): Promise<string | TrackerFailure> =>
	params.settings.provider === 'linear'
		? readLinearTicketAsset({ ...params, settings: params.settings })
		: readJiraTicketAsset({ ...params, settings: params.settings });
