import type { LightsoutConfig } from '#src/contracts/index.ts';
import { TrackerStatusRole } from '#src/ticketLifecycle/common/constants/TrackerStatusRole.ts';
import { resolveLifecycleSettings } from '#src/ticketLifecycle/resolveLifecycleSettings.ts';
import { updateTicketLifecycle } from '#src/ticketLifecycle/updateTicketLifecycle.ts';
import { getTicketsByIdentifiers, resolveTrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	config: LightsoutConfig;
	/** The process environment the tracker credentials are read from. Passed rather than read, so a test never needs to mutate `process.env`. */
	env: NodeJS.ProcessEnv;
	/**
	 * The shipped result's `ticketRef`. Optional because `ShipResult` documents
	 * every field beyond `status` as optional so one schema parses both
	 * outcomes — this function owns the missing case rather than making each
	 * caller guard it.
	 */
	ticketRef: string | undefined;
	onProgress?: (message: string) => void;
}

/**
 * The Done write that follows a positively confirmed merge, and the one
 * sentence saying it did not happen.
 *
 * Nothing here throws and nothing here reports failure by any channel that
 * could make a shipped branch look unshipped: a tracker failure cannot undo a
 * confirmed merge, so every failure path is a returned sentence the caller
 * prints beside the ship it already recorded as successful.
 *
 * A repository with no `ticket-tracker` block is answered before the missing
 * reference is: it never asked for reconciliation, so a warning about a ticket
 * reference would be noise on every ship it ever runs.
 *
 * No planning status is written. The ticket's shaping history is not this
 * write's business — a merge says nothing about what preparation the work
 * needed.
 *
 * @returns undefined when the ticket now says Done, or one sentence naming why it does not
 */
export const reconcileShippedTicket = async ({ config, env, ticketRef, onProgress }: Params): Promise<string | undefined> => {
	if (config['ticket-tracker'] === undefined) {
		return undefined;
	}

	if (ticketRef === undefined) {
		return 'the merge is done, but the branch carried no ticket reference the configured `ship.ticket-pattern` matches, so no ticket could be moved to Done';
	}

	const trackerSettings = resolveTrackerSettings({ config, env });

	if ('error' in trackerSettings) {
		return `${ticketRef} shipped, but the tracker could not be reached to move it to Done: ${trackerSettings.error}`;
	}

	const lifecycle = resolveLifecycleSettings({ config });

	if ('error' in lifecycle) {
		return `${ticketRef} shipped, but the lifecycle settings could not be resolved to move it to Done: ${lifecycle.error}`;
	}

	const found = await getTicketsByIdentifiers({ settings: trackerSettings, identifiers: [ticketRef] });

	if ('error' in found) {
		return `${ticketRef} shipped, but the tracker could not be read to move it to Done: ${found.error}`;
	}

	const ticket = found[0];

	if (ticket === undefined) {
		return `${ticketRef} shipped, but the tracker returned no ticket with that identifier, so it could not be moved to Done`;
	}

	const doneStatus = lifecycle.statusNames[TrackerStatusRole.Done];
	const failure = await updateTicketLifecycle({
		lifecycle,
		trackerSettings,
		ticketId: ticket.id,
		trackerStatus: TrackerStatusRole.Done,
		currentStatus: ticket.status,
	});

	if (failure !== undefined) {
		return `${ticketRef} shipped, but its tracker status could not be moved to '${doneStatus}': ${failure.error}`;
	}

	onProgress?.(`${ticketRef} · moved to '${doneStatus}'`);

	return undefined;
};
