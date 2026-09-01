import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { getTicketsByIdentifiers as getJiraTicketsByIdentifiers } from '#src/queue/tracker/jira/index.ts';
import { getTicketsByIdentifiers as getLinearTicketsByIdentifiers } from '#src/queue/tracker/linear/getTicketsByIdentifiers.ts';

interface Params {
	settings: QueueSettings;
	/** Human references, e.g. ['LO-70', 'LO-71'] — matched case-insensitively. */
	identifiers: string[];
}

/**
 * The resume path's lookup: these exact tickets, fetched with NO status filter.
 *
 * A ticket parked mid-drain sits at the in-progress status, which is exactly
 * what `listEligibleTickets`'s status filter hides — so the worktree directory
 * is the durable record of parked work, and this is how its tickets are read
 * back.
 *
 * A ticket matching more than one route label yields one summary per match, so
 * the drain's double-label skip sees it exactly as it sees one from the
 * eligible list.
 */
export const getTicketsByIdentifiers = async ({ settings, identifiers }: Params): Promise<TicketSummary[] | QueueFailure> => {
	return settings.tracker === 'linear' ? getLinearTicketsByIdentifiers({ settings, identifiers }) : getJiraTicketsByIdentifiers({ settings, identifiers });
};
