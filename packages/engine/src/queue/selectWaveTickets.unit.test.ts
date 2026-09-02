import { describe, expect, test } from '@jest/globals';
import { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { selectWaveTickets } from '#src/queue/selectWaveTickets.ts';
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
	route: QueueRoute.Direct,
	unfinishedBlockers: [],
	...overrides,
});

const select = ({ tickets, attempted = [] }: { tickets: TicketSummary[]; attempted?: string[] }) => {
	const progress: string[] = [];
	const selection = selectWaveTickets({
		tickets,
		settings,
		attempted: new Set(attempted),
		onProgress: (message) => progress.push(message),
	});

	return { ...selection, progress };
};

describe('selectWaveTickets', () => {
	test('takes a ticket nothing blocks', () => {
		const { runnable, blocked } = select({ tickets: [ticketOf()] });

		expect(runnable).toEqual([expect.objectContaining({ identifier: 'LO-70' })]);
		expect(blocked).toStrictEqual([]);
	});

	test('holds a blocked ticket back and names the blocker, so a human reads why it did not run', () => {
		const { runnable, blocked } = select({ tickets: [ticketOf({ unfinishedBlockers: ['LO-69'] })] });

		expect(runnable).toStrictEqual([]);
		expect(blocked).toEqual([{ identifier: 'LO-70', reason: expect.stringContaining('blocked by LO-69') }]);
	});

	test('names every unfinished blocker, because the ticket waits on all of them', () => {
		const { blocked } = select({ tickets: [ticketOf({ unfinishedBlockers: ['LO-68', 'LO-69'] })] });

		expect(blocked).toEqual([{ identifier: 'LO-70', reason: expect.stringContaining('blocked by LO-68, LO-69') }]);
	});

	test('announces the hold-back as progress, the same way the double-label skip is announced', () => {
		const { progress } = select({ tickets: [ticketOf({ unfinishedBlockers: ['LO-69'] })] });

		expect(progress).toEqual([expect.stringContaining('LO-70 · waiting: blocked by LO-69')]);
	});

	test('drops a ticket an earlier wave was already offered, whichever bucket it would land in — that is what makes the wave loop terminate', () => {
		const { runnable, blocked, skipped } = select({
			tickets: [ticketOf(), ticketOf({ id: 'id-71', identifier: 'LO-71', unfinishedBlockers: ['LO-69'] })],
			attempted: ['lo-70', 'lo-71'],
		});

		expect(runnable).toStrictEqual([]);
		expect(blocked).toStrictEqual([]);
		expect(skipped).toStrictEqual([]);
	});

	test('matches a mixed-case tracker identifier against the lower-cased attempted set, because the tracker’s casing is not the queue’s', () => {
		const { runnable } = select({ tickets: [ticketOf({ identifier: 'Lo-70' })], attempted: ['lo-70'] });

		expect(runnable).toStrictEqual([]);
	});

	test('drops both route copies of an already-attempted ticket together, so one leftover copy never reads as a clean single-label ticket', () => {
		const { runnable, blocked, skipped } = select({
			tickets: [ticketOf(), ticketOf({ route: QueueRoute.AutoPlan })],
			attempted: ['lo-70'],
		});

		expect(runnable).toStrictEqual([]);
		expect(blocked).toStrictEqual([]);
		expect(skipped).toStrictEqual([]);
	});

	test('skips a double-labelled ticket rather than running it, because guessing a route could run the wrong worker', () => {
		const { runnable, skipped } = select({ tickets: [ticketOf(), ticketOf({ route: QueueRoute.AutoPlan })] });

		expect(runnable).toStrictEqual([]);
		expect(skipped).toEqual([{ identifier: 'LO-70', reason: expect.stringContaining('both route labels') }]);
	});

	test('holds a resumed ticket back on its blockers exactly as a fresh one, because resuming is a pickup too', () => {
		const resumed = ticketOf({ id: 'id-99', identifier: 'LO-99', unfinishedBlockers: ['LO-69'] });
		const { runnable, blocked } = select({ tickets: [resumed, ticketOf()] });

		expect(runnable).toEqual([expect.objectContaining({ identifier: 'LO-70' })]);
		expect(blocked).toEqual([{ identifier: 'LO-99', reason: expect.stringContaining('blocked by LO-69') }]);
	});
});
