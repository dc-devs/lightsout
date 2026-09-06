import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import type { WaveSelection } from '#src/queue/common/types/WaveSelection.ts';
import type { LaneState } from '#src/queue/drainLanes/common/types/LaneState.ts';

interface Params {
	state: LaneState;
	selection: WaveSelection;
}

/**
 * One scan's selection folded into the ledger — the single path the opening
 * selection and every re-scan take, so a ticket is admitted once and settled
 * once.
 *
 * A blocked entry is deliberately NOT marked attempted: that is what lets a
 * later scan offer it once its blocker has merged. It is remembered under its
 * identifier instead, so it stays reportable after later scans stop returning
 * it, and leaves that map only by being admitted or settled.
 *
 * @returns the tickets this selection added to the run, in admission order
 */
export const admitSelection = ({ state, selection }: Params): RunnableTicket[] => {
	const admitted: RunnableTicket[] = [];

	for (const ticket of selection.runnable) {
		const identifier = ticket.identifier.toLowerCase();

		if (!state.attempted.has(identifier)) {
			state.attempted.add(identifier);
			state.blockedByIdentifier.delete(identifier);
			state.pending.push(ticket);
			state.queued.push(ticket);
			admitted.push(ticket);
		}
	}

	for (const entry of selection.blocked) {
		state.blockedByIdentifier.set(entry.identifier.toLowerCase(), entry);
	}

	for (const entry of selection.skipped) {
		state.attempted.add(entry.identifier.toLowerCase());
		state.blockedByIdentifier.delete(entry.identifier.toLowerCase());
		state.leftBehind.push(entry);
	}

	return admitted;
};
