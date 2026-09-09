import { describeGateHold, type GateHolds, isTicketGateHeld } from '#src/gates/index.ts';
import type { LeftBehindTicket } from '#src/queue/common/types/LeftBehindTicket.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { WaveSelection } from '#src/queue/common/types/WaveSelection.ts';
import { dedupeTickets } from '#src/queue/ticketSelection/dedupeTickets.ts';

interface Params {
	/** Resumed and eligible tickets together, already in the order they would be worked. */
	tickets: TicketSummary[];
	settings: QueueSettings;
	/** Lower-cased identifiers this invocation has already offered to a wave. */
	attempted: Set<string>;
	/** The holds this drain reconciled once, at its start. */
	holds: GateHolds;
	onProgress?: (message: string) => void;
}

/**
 * What one wave may take, and what it must hold back.
 *
 * The already-attempted filter runs BEFORE the dedupe, so every copy of a
 * ticket carrying more than one planning-status label leaves together and the
 * ambiguity check still sees every copy of the tickets that remain. It is also
 * what makes the wave loop terminate: a ticket offered to any wave is never
 * offered again.
 *
 * A ticket whose pair selects no worker is dropped in silence: a ticket still
 * being shaped, or one not yet waiting to be implemented, is an ordinary state,
 * and reporting every one of them would bury the real skips.
 *
 * A ticket with an unfinished blocker is left behind rather than reordered — the
 * queue drains everything unblocked, then re-scans, and correct chain order
 * falls out of the repetition.
 *
 * A held ticket leaves through the same `blocked` channel, and deliberately not
 * through `skipped`: a hold is released by a human at a moment nothing here can
 * predict, so the ticket is re-offered by the next scan exactly as a blocked one
 * is rather than being settled for the invocation.
 */
export const selectWaveTickets = ({ tickets, settings, attempted, holds, onProgress }: Params): WaveSelection => {
	const fresh = tickets.filter((ticket) => !attempted.has(ticket.identifier.toLowerCase()));
	const { ordered, leftBehind } = dedupeTickets({ tickets: fresh, settings, onProgress });
	const runnable: RunnableTicket[] = [];
	const blocked: LeftBehindTicket[] = [];

	for (const ticket of ordered) {
		if (ticket.worker === undefined) {
			continue;
		}

		if (isTicketGateHeld({ holds, identifier: ticket.identifier, labels: ticket.labels })) {
			const held = describeGateHold({ hold: holds[ticket.identifier.toLowerCase()], identifier: ticket.identifier });

			onProgress?.(`${ticket.identifier} · ${held}`);
			blocked.push({ identifier: ticket.identifier, reason: held });
			continue;
		}

		if (ticket.unfinishedBlockers.length === 0) {
			runnable.push({ ...ticket, worker: ticket.worker });
			continue;
		}

		const reason = `waiting: blocked by ${ticket.unfinishedBlockers.join(', ')} — the queue takes it once every blocker is finished`;

		onProgress?.(`${ticket.identifier} · ${reason}`);
		blocked.push({ identifier: ticket.identifier, reason });
	}

	return { runnable, blocked, skipped: leftBehind };
};
