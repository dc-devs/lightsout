import type { LeftBehindTicket } from '#src/queue/common/types/LeftBehindTicket.ts';
import type { QueueDrainReport } from '#src/queue/common/types/QueueDrainReport.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';

interface Params {
	/** Tickets in the order they will be picked up. */
	queued: TicketSummary[];
	maxParallel: number;
	/** One ticket, from worktree to committed-and-ready. */
	runTicket: (params: { ticket: TicketSummary }) => Promise<TicketRunOutcome>;
	onProgress?: (message: string) => void;
}

/**
 * Work the queue with at most `maxParallel` tickets in flight.
 *
 * A slot whose ticket parked on an UNANSWERED question is RETIRED; every other
 * slot is refilled, ready or failed. An unanswered question means the human is
 * away, and a fully retired budget then ends the drain with the remaining
 * tickets announced rather than piling up questions nobody is reading. A plain
 * failure holds no human and blocks nothing — retiring on it once halved a
 * whole night's drain because one worker crashed early.
 */
export const drainTickets = async ({ queued, maxParallel, runTicket, onProgress }: Params): Promise<QueueDrainReport> => {
	const outcomes: TicketRunOutcome[] = [];
	const pending = [...queued];
	const running = new Map<number, Promise<number>>();
	let available = maxParallel;
	let nextKey = 0;

	for (;;) {
		while (available > 0 && pending.length > 0) {
			const ticket = pending.shift();

			if (ticket === undefined) {
				break;
			}

			const key = nextKey;

			nextKey += 1;
			available -= 1;
			running.set(
				key,
				runTicket({ ticket }).then((outcome) => {
					outcomes.push(outcome);

					if (outcome.unanswered !== true) {
						available += 1;
					}

					return key;
				}),
			);
		}

		if (running.size === 0) {
			break;
		}

		running.delete(await Promise.race(running.values()));
	}

	const leftBehind: LeftBehindTicket[] = pending.map((ticket) => ({
		identifier: ticket.identifier,
		reason: 'not started: every slot was retired by a ticket parked on an unanswered question',
	}));

	for (const entry of leftBehind) {
		onProgress?.(`${entry.identifier} · ${entry.reason}`);
	}

	return { outcomes, leftBehind };
};
