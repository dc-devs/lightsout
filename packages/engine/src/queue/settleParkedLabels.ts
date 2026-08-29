import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import { setParkedLabel } from '#src/queue/tracker/index.ts';

interface Params {
	settings: QueueSettings;
	/** Every settled outcome, after `shipReadyBranches` has run. */
	outcomes: TicketRunOutcome[];
	onProgress?: (message: string) => void;
}

/**
 * The parked label, settled once per drain: on every outcome that did not ship,
 * off every outcome that did.
 *
 * Doing it here rather than at each park site is what keeps the label honest —
 * a ticket that parks in the worker and a ticket that parks at the ship step
 * are the same fact to whoever is watching the tracker, and there is one list
 * that knows both.
 *
 * A failed write is a progress line and nothing more: the tracker is a courtesy
 * to whoever is watching, never a precondition for building.
 */
export const settleParkedLabels = async ({ settings, outcomes, onProgress }: Params): Promise<void> => {
	if (settings.parkedLabel === undefined) {
		return;
	}

	await Promise.all(
		outcomes.map(async (outcome) => {
			const written = await setParkedLabel({ settings, ticketId: outcome.ticket.id, parked: !outcome.ready });

			if (written !== undefined) {
				onProgress?.(`${outcome.ticket.identifier} · the '${settings.parkedLabel}' label could not be written: ${written.error}`);
			}
		}),
	);
};
