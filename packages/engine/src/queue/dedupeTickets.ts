import type { LeftBehindTicket } from '#src/queue/common/types/LeftBehindTicket.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';

interface Params {
	/** The resumed and eligible tickets together, already in the order they will be worked. */
	tickets: TicketSummary[];
	settings: QueueSettings;
	onProgress?: (message: string) => void;
}

/**
 * The queue in the order it will be worked, with each ticket appearing once.
 *
 * A repo whose in-progress status is also an eligible status hands back the same
 * parked ticket from both the resume scan and the eligible list; the resumed
 * entry wins, because it is the one carrying the existing worktree. A ticket
 * someone labelled with BOTH route labels is removed entirely and announced: the
 * queue only runs what a human unambiguously delegated, and guessing a route
 * could run the wrong worker.
 */
export const dedupeTickets = ({ tickets, settings, onProgress }: Params): { ordered: TicketSummary[]; leftBehind: LeftBehindTicket[] } => {
	const leftBehind: LeftBehindTicket[] = [];
	const ordered: TicketSummary[] = [];
	const seen = new Set<string>();

	for (const ticket of tickets) {
		const key = ticket.identifier.toLowerCase();

		if (seen.has(key)) {
			continue;
		}

		seen.add(key);

		const routes = new Set(tickets.filter((other) => other.identifier.toLowerCase() === key).map((other) => other.route));

		if (routes.size < 2) {
			ordered.push(ticket);
			continue;
		}

		const labels = [...routes].map((route) => `'${settings.routeLabels[route]}'`).join(' and ');
		const reason = `skipped: it carries both route labels, ${labels} — remove one so the queue knows which worker to run`;

		onProgress?.(`${ticket.identifier} · ${reason}`);
		leftBehind.push({ identifier: ticket.identifier, reason });
	}

	return { ordered, leftBehind };
};
