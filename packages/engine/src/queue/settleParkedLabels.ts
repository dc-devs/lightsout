import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { WorkOrderRunOutcome } from '#src/queue/common/types/WorkOrderRunOutcome.ts';
import { isParkedOutcome } from '#src/queue/common/utils/isParkedOutcome.ts';
import { setTicketLabel, type TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	settings: QueueSettings;
	trackerSettings: TrackerSettings;
	/** Every settled outcome, after `shipOneBranch` has finished with each ready branch. */
	outcomes: WorkOrderRunOutcome[];
	onProgress?: (message: string) => void;
}

/**
 * The parked label, settled once per drain: on every parked outcome, off every
 * other one.
 *
 * A ticket the queue left open has the label cleared exactly as a shipped one
 * does — it is waiting on a human decision rather than parked — which is why the
 * `present` value reads the one rule that says which outcomes are parks.
 *
 * Doing it here rather than at each park site is what keeps the label honest —
 * a ticket that parks in the worker and a ticket that parks at the ship step
 * are the same fact to whoever is watching the tracker, and there is one list
 * that knows both.
 *
 * A failed write is a progress line and nothing more: the tracker is a courtesy
 * to whoever is watching, never a precondition for building.
 */
export const settleParkedLabels = async ({ settings, trackerSettings, outcomes, onProgress }: Params): Promise<void> => {
	if (settings.parkedLabel === undefined) {
		return;
	}

	await Promise.all(
		outcomes.map(async (outcome) => {
			const written = await setTicketLabel({
				settings: trackerSettings,
				ticketId: outcome.ticket.id,
				label: settings.parkedLabel,
				present: isParkedOutcome({ outcome }),
			});

			if (written !== undefined) {
				onProgress?.(`${outcome.ticket.identifier} · the '${settings.parkedLabel}' label could not be written: ${written.error}`);
			}
		}),
	);
};
