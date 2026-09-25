import type { TrackerAttachment } from '#src/ticketTracker/common/types/TrackerAttachment.ts';
import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { getTicketAttachments as getJiraTicketAttachments } from '#src/ticketTracker/jira/getTicketAttachments.ts';
import { getTicketAttachments as getLinearTicketAttachments } from '#src/ticketTracker/linear/getTicketAttachments.ts';

interface Params {
	settings: TrackerSettings;
	identifier: string;
}

export const getTicketAttachments = async (params: Params): Promise<TrackerAttachment[] | TrackerFailure> =>
	params.settings.provider === 'linear'
		? getLinearTicketAttachments({ ...params, settings: params.settings })
		: getJiraTicketAttachments({ ...params, settings: params.settings });
