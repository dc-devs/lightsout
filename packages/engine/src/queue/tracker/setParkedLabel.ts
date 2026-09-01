import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import { setParkedLabel as setJiraParkedLabel } from '#src/queue/tracker/jira/index.ts';
import { setParkedLabel as setLinearParkedLabel } from '#src/queue/tracker/linear/setParkedLabel.ts';

interface Params {
	settings: QueueSettings;
	/** The ticket's internal id, from `TicketSummary.id`. */
	ticketId: string;
	/** true when the ticket has just parked, false when it resumed or shipped. */
	parked: boolean;
}

/**
 * Put the configured parked label on a ticket, or take it off.
 *
 * A no-op when no `parked-label` is configured: the label is opt-in, and a repo
 * that never named one must never have one invented for it.
 *
 * Linear creates the team label on first use; Jira labels are direct issue
 * values and need no metadata creation.
 */
export const setParkedLabel = async ({ settings, ticketId, parked }: Params): Promise<QueueFailure | undefined> => {
	return settings.tracker === 'linear' ? setLinearParkedLabel({ settings, ticketId, parked }) : setJiraParkedLabel({ settings, ticketId, parked });
};
