import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { setTicketAttachment as setJiraTicketAttachment } from '#src/ticketTracker/jira/index.ts';
import { setTicketAttachment as setLinearTicketAttachment } from '#src/ticketTracker/linear/index.ts';

interface Params {
	settings: TrackerSettings;
	ticketId: string;
	title: string;
	content: Buffer;
	contentType: string;
}

export const setTicketAttachment = async (params: Params): Promise<TrackerFailure | undefined> =>
	params.settings.provider === 'linear'
		? setLinearTicketAttachment({ ...params, settings: params.settings })
		: setJiraTicketAttachment({ ...params, settings: params.settings });
