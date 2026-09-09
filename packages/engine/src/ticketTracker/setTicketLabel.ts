import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { setTicketLabel as setJiraTicketLabel } from '#src/ticketTracker/jira/index.ts';
import { setTicketLabel as setLinearTicketLabel } from '#src/ticketTracker/linear/index.ts';

interface Params {
	settings: TrackerSettings;
	ticketId: string;
	/** The label to settle. Undefined writes nothing and succeeds. */
	label: string | undefined;
	/** Whether the label should end up on the ticket. False takes it off. */
	present: boolean;
}

/**
 * Adds one label to a ticket or takes it off, whichever `present` asks for.
 *
 * An undefined `label` is a deliberate no-op that answers success, which is the
 * shape a caller holding an optional configured label wants: it hands the value
 * straight through rather than guarding, and an unconfigured label settles
 * nothing instead of failing.
 */
export const setTicketLabel = async (params: Params): Promise<TrackerFailure | undefined> =>
	params.settings.provider === 'linear'
		? setLinearTicketLabel({ ...params, settings: params.settings })
		: setJiraTicketLabel({ ...params, settings: params.settings });
