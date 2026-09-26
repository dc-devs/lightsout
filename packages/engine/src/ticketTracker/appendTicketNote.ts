import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { appendTicketNote as appendJiraTicketNote } from '#src/ticketTracker/jira/appendTicketNote.ts';
import { appendTicketNote as appendLinearTicketNote } from '#src/ticketTracker/linear/appendTicketNote.ts';

interface Params {
	settings: TrackerSettings;
	ticketId: string;
	heading: string;
	line: string;
}

export const appendTicketNote = async (params: Params): Promise<TrackerFailure | undefined> =>
	params.settings.provider === 'linear'
		? appendLinearTicketNote({ ...params, settings: params.settings })
		: appendJiraTicketNote({ ...params, settings: params.settings });
