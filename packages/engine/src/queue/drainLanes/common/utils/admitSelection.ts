import type { LeftBehindTicket } from '#src/queue/common/types/LeftBehindTicket.ts';
import type { NamedWorkOrder } from '#src/queue/common/types/NamedWorkOrder.ts';
import type { LaneState } from '#src/queue/drainLanes/common/types/LaneState.ts';

interface Params {
	state: LaneState;
	/** The wave's named work orders, in the order they would be picked up. */
	workOrders: NamedWorkOrder[];
	/** Tickets held back until every blocker finishes — re-offered by the next scan. */
	blocked: LeftBehindTicket[];
	/** Tickets settled for good. Never re-offered. */
	skipped: LeftBehindTicket[];
}

/**
 * One scan's named work orders folded into the ledger — the single path the
 * opening selection and every re-scan take, so a ticket is admitted once and
 * settled once.
 *
 * It takes the three lists directly rather than a `WaveSelection`, because a
 * selection is what a scan produces BEFORE anything is named, and keeping that
 * seam is what keeps selection free of the network.
 *
 * A blocked entry is deliberately NOT marked attempted: that is what lets a
 * later scan offer it once its blocker has merged. It is remembered under its
 * identifier instead, so it stays reportable after later scans stop returning
 * it, and leaves that map only by being admitted or settled.
 *
 * @returns the work orders this scan added to the run, in admission order
 */
export const admitSelection = ({ state, workOrders, blocked, skipped }: Params): NamedWorkOrder[] => {
	const admitted: NamedWorkOrder[] = [];

	for (const workOrder of workOrders) {
		const identifier = workOrder.ticket.identifier.toLowerCase();

		if (!state.attempted.has(identifier)) {
			state.attempted.add(identifier);
			state.blockedByIdentifier.delete(identifier);
			state.pending.push(workOrder);
			state.queued.push(workOrder);
			admitted.push(workOrder);
		}
	}

	for (const entry of blocked) {
		state.blockedByIdentifier.set(entry.identifier.toLowerCase(), entry);
	}

	for (const entry of skipped) {
		state.attempted.add(entry.identifier.toLowerCase());
		state.blockedByIdentifier.delete(entry.identifier.toLowerCase());
		state.leftBehind.push(entry);
	}

	return admitted;
};
