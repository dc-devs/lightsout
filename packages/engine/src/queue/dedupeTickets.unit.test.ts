import { describe, expect, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { dedupeTickets } from '#src/queue/dedupeTickets.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';

const settings = queueSettingsFixture();

const ticketOf = (overrides: Partial<TicketSummary> = {}): TicketSummary => ({
	id: 'id-70',
	identifier: 'LO-70',
	title: 'Drain the backlog',
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: [],
	planningStatus: PlanningStatus.NotNeeded,
	worker: QueueWorker.Direct,
	status: 'Ready to implement',
	unfinishedBlockers: [],
	...overrides,
});

describe('dedupeTickets', () => {
	test('leaves an ordinary queue exactly as it was given', () => {
		const tickets = [
			ticketOf(),
			ticketOf({ id: 'id-71', identifier: 'LO-71', planningStatus: PlanningStatus.ReadyAutoPlan, worker: QueueWorker.AutoPlan, status: 'Backlog' }),
		];

		expect(dedupeTickets({ tickets, settings }).ordered.map((ticket) => ticket.identifier)).toStrictEqual(['LO-70', 'LO-71']);
	});

	test('keeps the resumed entry when a repo lists its in-progress status among the eligible ones — that entry carries the existing worktree', () => {
		const resumed = ticketOf({ title: 'Resumed copy' });
		const fresh = ticketOf({ title: 'Eligible copy' });

		const { ordered, leftBehind } = dedupeTickets({ tickets: [resumed, fresh], settings });

		expect(ordered).toStrictEqual([resumed]);
		expect(leftBehind).toStrictEqual([]);
	});

	test('skips a ticket carrying more than one planning status label, naming each so a human can leave one', () => {
		const progress: string[] = [];
		const tickets = [ticketOf(), ticketOf({ planningStatus: PlanningStatus.Complete, worker: QueueWorker.Plan })];

		const { ordered, leftBehind } = dedupeTickets({ tickets, settings, onProgress: (message) => progress.push(message) });

		expect(ordered).toStrictEqual([]);
		expect(leftBehind).toEqual([{ identifier: 'LO-70', reason: expect.stringContaining("'planning-complete' and 'planning-not-needed'") }]);
		expect(progress).toEqual([expect.stringContaining('LO-70 ·')]);
	});

	test('reports an ambiguous ticket once, not once per planning status label it carries', () => {
		const tickets = [ticketOf(), ticketOf({ planningStatus: PlanningStatus.Complete, worker: QueueWorker.Plan })];

		expect(dedupeTickets({ tickets, settings }).leftBehind).toHaveLength(1);
	});

	test('matches identifiers however they are cased, because a branch spells one lowercase and the tracker spells it up', () => {
		const tickets = [ticketOf({ identifier: 'lo-70' }), ticketOf({ identifier: 'LO-70' })];

		expect(dedupeTickets({ tickets, settings }).ordered).toHaveLength(1);
	});
});
