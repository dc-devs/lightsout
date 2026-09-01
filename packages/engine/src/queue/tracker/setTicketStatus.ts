import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import { setTicketStatus as setJiraTicketStatus } from '#src/queue/tracker/jira/index.ts';
import { setTicketStatus as setLinearTicketStatus } from '#src/queue/tracker/linear/setTicketStatus.ts';

interface Params {
	settings: QueueSettings;
	/** The ticket's internal id, from `TicketSummary.id`. */
	ticketId: string;
	statusName: string;
}

/**
 * Move one ticket to a named status, answering undefined when the tracker
 * accepted it — the same convention `pushBranch` uses.
 *
 * A name the team has no workflow state for is a failure naming the status, not
 * a silent no-op: a status nobody can see is a status nobody configured.
 */
export const setTicketStatus = async ({ settings, ticketId, statusName }: Params): Promise<QueueFailure | undefined> => {
	return settings.tracker === 'linear' ? setLinearTicketStatus({ settings, ticketId, statusName }) : setJiraTicketStatus({ settings, ticketId, statusName });
};
