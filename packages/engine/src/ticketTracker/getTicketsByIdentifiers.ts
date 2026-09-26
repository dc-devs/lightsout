import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import type { TrackerTicket } from '#src/ticketTracker/common/types/TrackerTicket.ts';
import { getTicketsByIdentifiers as getJiraTicketsByIdentifiers } from '#src/ticketTracker/jira/getTicketsByIdentifiers.ts';
import { getTicketsByIdentifiers as getLinearTicketsByIdentifiers } from '#src/ticketTracker/linear/getTicketsByIdentifiers.ts';

interface Params {
	settings: TrackerSettings;
	identifiers: string[];
}

export const getTicketsByIdentifiers = async (params: Params): Promise<TrackerTicket[] | TrackerFailure> =>
	params.settings.provider === 'linear'
		? getLinearTicketsByIdentifiers({ ...params, settings: params.settings })
		: getJiraTicketsByIdentifiers({ ...params, settings: params.settings });
