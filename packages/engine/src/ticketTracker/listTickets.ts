import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import type { TrackerTicket } from '#src/ticketTracker/common/types/TrackerTicket.ts';
import { listTickets as listJiraTickets } from '#src/ticketTracker/jira/index.ts';
import { listTickets as listLinearTickets } from '#src/ticketTracker/linear/index.ts';

interface Params {
	settings: TrackerSettings;
	labelNames: string[];
	statuses: string[];
}

export const listTickets = async (params: Params): Promise<TrackerTicket[] | TrackerFailure> =>
	params.settings.provider === 'linear'
		? listLinearTickets({ ...params, settings: params.settings })
		: listJiraTickets({ ...params, settings: params.settings });
