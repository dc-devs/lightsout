import { describe, expect, test } from '@jest/globals';
import { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { orderTickets } from '#src/queue/orderTickets.ts';

const ticketOf = ({
	number,
	priority = 2,
	createdAt = '2026-01-01T00:00:00.000Z',
}: {
	number: number;
	priority?: number;
	createdAt?: string;
}): TicketSummary => ({
	id: `id-${number}`,
	identifier: `LO-${number}`,
	title: `Ticket ${number}`,
	description: '',
	priority,
	createdAt,
	route: QueueRoute.Direct,
	unfinishedBlockers: [],
});

const identifiersOf = ({ tickets }: { tickets: TicketSummary[] }) => tickets.map((ticket) => ticket.identifier);

describe('orderTickets', () => {
	test('works the most urgent ticket first, because that is the order a human drains a backlog in', () => {
		const tickets = [ticketOf({ number: 70, priority: 4 }), ticketOf({ number: 71, priority: 1 }), ticketOf({ number: 72, priority: 3 })];

		expect(identifiersOf({ tickets: orderTickets({ tickets }) })).toStrictEqual(['LO-71', 'LO-72', 'LO-70']);
	});

	test('sorts an unprioritised ticket last — Linear’s 0 means "no priority", not "the most urgent one there is"', () => {
		const tickets = [ticketOf({ number: 70, priority: 0 }), ticketOf({ number: 71, priority: 4 })];

		expect(identifiersOf({ tickets: orderTickets({ tickets }) })).toStrictEqual(['LO-71', 'LO-70']);
	});

	test('keeps Jira Lowest before an unprioritised ticket', () => {
		const tickets = [ticketOf({ number: 70, priority: 0 }), ticketOf({ number: 71, priority: 5 })];

		expect(identifiersOf({ tickets: orderTickets({ tickets }) })).toStrictEqual(['LO-71', 'LO-70']);
	});

	test('breaks a priority tie with the oldest ticket, so nothing sits in the backlog forever', () => {
		const tickets = [
			ticketOf({ number: 70, priority: 2, createdAt: '2026-03-01T00:00:00.000Z' }),
			ticketOf({ number: 71, priority: 2, createdAt: '2026-01-01T00:00:00.000Z' }),
		];

		expect(identifiersOf({ tickets: orderTickets({ tickets }) })).toStrictEqual(['LO-71', 'LO-70']);
	});

	test('leaves the list it was given untouched, because the caller keeps reading it', () => {
		const tickets = [ticketOf({ number: 70, priority: 4 }), ticketOf({ number: 71, priority: 1 })];

		orderTickets({ tickets });

		expect(identifiersOf({ tickets })).toStrictEqual(['LO-70', 'LO-71']);
	});
});
