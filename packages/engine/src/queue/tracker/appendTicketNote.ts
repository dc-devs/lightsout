import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import { appendTicketNote as appendJiraTicketNote } from '#src/queue/tracker/jira/index.ts';
import { appendTicketNote as appendLinearTicketNote } from '#src/queue/tracker/linear/appendTicketNote.ts';

interface Params {
	settings: QueueSettings;
	ticketId: string;
	/** The section heading to write under, e.g. '## Decisions'. Created at the end of the body when absent. */
	heading: string;
	/** One line, already formatted — usually a `- ` bullet. */
	line: string;
}

/**
 * Append one line to a section of the ticket's body, creating the section when
 * the ticket has none.
 *
 * The read and the write share one call, so they cannot end up with different
 * deadlines — a body written back from a read a minute old is a body that
 * silently discards whatever happened in between.
 */
export const appendTicketNote = async ({ settings, ticketId, heading, line }: Params): Promise<QueueFailure | undefined> => {
	return settings.tracker === 'linear'
		? appendLinearTicketNote({ settings, ticketId, heading, line })
		: appendJiraTicketNote({ settings, ticketId, heading, line });
};
