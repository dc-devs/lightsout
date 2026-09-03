import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
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
 * carrying more than one planning-status label is removed entirely and
 * announced: the queue only runs what a human unambiguously delegated, and
 * guessing which preparation a ticket still owes could run the wrong worker.
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

		const carried = new Set(tickets.filter((other) => other.identifier.toLowerCase() === key).map((other) => other.planningStatus));

		if (carried.size < 2) {
			ordered.push(ticket);
			continue;
		}

		const labels = Object.values(PlanningStatus)
			.filter((status) => carried.has(status))
			.map((status) => `'${settings.lifecycle.planningStatusLabels[status]}'`)
			.join(' and ');
		const reason = `skipped: it carries the planning status labels ${labels} — leave exactly one so the queue knows what the ticket still owes`;

		onProgress?.(`${ticket.identifier} · ${reason}`);
		leftBehind.push({ identifier: ticket.identifier, reason });
	}

	return { ordered, leftBehind };
};
