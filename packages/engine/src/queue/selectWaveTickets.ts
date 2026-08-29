import type { LeftBehindTicket } from '#src/queue/common/types/LeftBehindTicket.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { WaveSelection } from '#src/queue/common/types/WaveSelection.ts';
import { dedupeTickets } from '#src/queue/dedupeTickets.ts';

interface Params {
	/** Resumed and eligible tickets together, already in the order they would be worked. */
	tickets: TicketSummary[];
	settings: QueueSettings;
	/** Lower-cased identifiers this invocation has already offered to a wave. */
	attempted: Set<string>;
	onProgress?: (message: string) => void;
}

/**
 * What one wave may take, and what it must hold back.
 *
 * The already-attempted filter runs BEFORE the dedupe, so both route-labelled
 * copies of a ticket leave together and the double-label check still sees every
 * copy of the tickets that remain. It is also what makes the wave loop
 * terminate: a ticket offered to any wave is never offered again.
 *
 * A ticket with an unfinished blocker is left behind rather than reordered — the
 * queue drains everything unblocked, then re-scans, and correct chain order
 * falls out of the repetition.
 */
export const selectWaveTickets = ({ tickets, settings, attempted, onProgress }: Params): WaveSelection => {
	const fresh = tickets.filter((ticket) => !attempted.has(ticket.identifier.toLowerCase()));
	const { ordered, leftBehind } = dedupeTickets({ tickets: fresh, settings, onProgress });
	const runnable: TicketSummary[] = [];
	const blocked: LeftBehindTicket[] = [];

	for (const ticket of ordered) {
		if (ticket.unfinishedBlockers.length === 0) {
			runnable.push(ticket);
			continue;
		}

		const reason = `waiting: blocked by ${ticket.unfinishedBlockers.join(', ')} — the queue takes it once every blocker is finished`;

		onProgress?.(`${ticket.identifier} · ${reason}`);
		blocked.push({ identifier: ticket.identifier, reason });
	}

	return { runnable, blocked, skipped: leftBehind };
};
