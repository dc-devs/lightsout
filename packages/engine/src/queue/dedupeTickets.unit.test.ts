import { describe, expect, test } from '@jest/globals';
import { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { dedupeTickets } from '#src/queue/dedupeTickets.ts';

const settings: QueueSettings = {
	team: 'LO',
	routeLabels: { direct: 'route-direct', 'auto-plan': 'route-auto-plan' },
	maxParallel: 2,
	apiKey: 'lin_key',
	eligibleStatuses: ['Backlog'],
	inProgressStatus: 'In Progress',
	branchTemplate: '{ticket}-{slug}',
	decisionsHeading: '## Decisions',
	workerMinutes: 240,
};

const ticketOf = (overrides: Partial<TicketSummary> = {}): TicketSummary => ({
	id: 'id-70',
	identifier: 'LO-70',
	title: 'Drain the backlog',
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	route: QueueRoute.Direct,
	...overrides,
});

describe('dedupeTickets', () => {
	test('leaves an ordinary queue exactly as it was given', () => {
		const tickets = [ticketOf(), ticketOf({ id: 'id-71', identifier: 'LO-71', route: QueueRoute.AutoPlan })];

		expect(dedupeTickets({ tickets, settings }).ordered.map((ticket) => ticket.identifier)).toStrictEqual(['LO-70', 'LO-71']);
	});

	test('keeps the resumed entry when a repo lists its in-progress status among the eligible ones — that entry carries the existing worktree', () => {
		const resumed = ticketOf({ title: 'Resumed copy' });
		const fresh = ticketOf({ title: 'Eligible copy' });

		const { ordered, leftBehind } = dedupeTickets({ tickets: [resumed, fresh], settings });

		expect(ordered).toStrictEqual([resumed]);
		expect(leftBehind).toStrictEqual([]);
	});

	test('skips a ticket carrying both route labels, naming both so a human can remove one', () => {
		const progress: string[] = [];
		const tickets = [ticketOf(), ticketOf({ route: QueueRoute.AutoPlan })];

		const { ordered, leftBehind } = dedupeTickets({ tickets, settings, onProgress: (message) => progress.push(message) });

		expect(ordered).toStrictEqual([]);
		expect(leftBehind).toEqual([{ identifier: 'LO-70', reason: expect.stringContaining("'route-direct' and 'route-auto-plan'") }]);
		expect(progress).toEqual([expect.stringContaining('LO-70 ·')]);
	});

	test('reports a double-labelled ticket once, not once per label it carries', () => {
		const tickets = [ticketOf(), ticketOf({ route: QueueRoute.AutoPlan })];

		expect(dedupeTickets({ tickets, settings }).leftBehind).toHaveLength(1);
	});

	test('matches identifiers however they are cased, because a branch spells one lowercase and the tracker spells it up', () => {
		const tickets = [ticketOf({ identifier: 'lo-70' }), ticketOf({ identifier: 'LO-70' })];

		expect(dedupeTickets({ tickets, settings }).ordered).toHaveLength(1);
	});
});
