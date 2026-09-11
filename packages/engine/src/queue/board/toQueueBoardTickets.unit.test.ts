import { describe, expect, test } from '@jest/globals';
import { type QueueBoardTicket, QueueLane } from '#src/contracts/index.ts';
import { toQueueBoardTickets } from '#src/queue/board/index.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { QueueDrainReport } from '#src/queue/index.ts';
import { queueOutcomeFixture } from '#tests/helpers/queueOutcomeFixture.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';

type LiveQueueBoard = NonNullable<Parameters<typeof toQueueBoardTickets>[0]['live']>;
/** Any mix of settled and live records, as a case names them. */
type BoardRecords = Partial<QueueDrainReport> & Partial<LiveQueueBoard>;

/** A drain report with nothing in flight, which is how the queue command draws its final board. */
const setupSettled = ({ outcomes = [], leftBehind = [] }: Partial<QueueDrainReport> = {}) => ({
	settled: { outcomes, leftBehind },
	at: '2026-09-10T12:00:00.000Z',
});

/** A drain still running: empty lanes, the default branch template and a fixed worktrees root, with each case filling only the lanes it is about. */
const setupLive = ({ outcomes = [], leftBehind = [], ...lanes }: Partial<QueueDrainReport> & Partial<LiveQueueBoard> = {}) => {
	const live: LiveQueueBoard = {
		pending: [],
		building: [],
		readyToShip: [],
		shipping: undefined,
		blocked: [],
		questions: new Map(),
		entered: new Map(),
		branchTemplate: '{ticket}-{slug}',
		worktreesRoot: '/worktrees/app',
		...lanes,
	};

	return { settled: { outcomes, leftBehind }, live, at: '2026-09-10T12:00:00.000Z' };
};

/** The fields a lane rule decides, so a case states only the lane and the reason it expects. */
const laneRows = (tickets: QueueBoardTicket[]) => tickets.map(({ identifier, lane, reason }) => ({ identifier, lane, reason }));

/**
 * One ticket, LO-60, named by every kind of record from `from` down the ranking:
 * a settled left-behind entry, the ship lane's branch, a ready branch, a build in
 * flight, an admitted ticket, then a still-held blocked entry.
 */
const setupRanked = ({ from }: { from: number }) => {
	const ticket = queueTicketFixture({ number: 60 });
	const ranked: BoardRecords[] = [
		{ leftBehind: [{ identifier: 'LO-60', reason: 'Already merged; reconciled to Done', settled: true }] },
		{ shipping: queueOutcomeFixture({ ticket }) },
		{ readyToShip: [queueOutcomeFixture({ ticket })] },
		{ building: [{ ticket, startedAt: '2026-09-10T11:00:00.000Z' }] },
		{ pending: [ticket] },
		{ blocked: [{ identifier: 'LO-60', reason: 'Blocked by LO-99, which is not finished' }] },
	];

	return setupLive(ranked.slice(from).reduce<BoardRecords>((merged, records) => Object.assign(merged, records), {}));
};

describe('toQueueBoardTickets', () => {
	test('puts shipped outcomes in Shipped and stopped ones in Parked with their reasons', () => {
		const { settled, at } = setupSettled({
			outcomes: [
				queueOutcomeFixture({ ticket: queueTicketFixture({ number: 1 }) }),
				queueOutcomeFixture({ ticket: queueTicketFixture({ number: 2 }), reconciliationFailure: 'Linear refused the Done write' }),
				queueOutcomeFixture({ ticket: queueTicketFixture({ number: 3 }), ready: false, error: 'The lint gate failed' }),
			],
		});

		const tickets = toQueueBoardTickets({ settled, at });

		expect(laneRows(tickets)).toEqual([
			{ identifier: 'LO-1', lane: 'shipped', reason: undefined },
			{ identifier: 'LO-2', lane: 'shipped', reason: 'Linear refused the Done write' },
			{ identifier: 'LO-3', lane: 'parked', reason: 'The lint gate failed' },
		]);
	});

	test('puts reconciled left-behind entries in Shipped and the rest in Blocked', () => {
		const { settled, at } = setupSettled({
			leftBehind: [
				{
					identifier: 'LO-4',
					reason: 'Already merged; reconciled to Done, but the Done write failed',
					settled: true,
					reconciliationFailure: 'Linear refused the Done write',
				},
				{ identifier: 'LO-5', reason: 'Blocked by LO-9, which is not finished' },
				{ identifier: 'LO-6', reason: 'Already merged; reconciled to Done', settled: true },
			],
		});

		const tickets = toQueueBoardTickets({ settled, at });

		expect(laneRows(tickets)).toEqual([
			{ identifier: 'LO-4', lane: 'shipped', reason: 'Linear refused the Done write' },
			{ identifier: 'LO-6', lane: 'shipped', reason: undefined },
			{ identifier: 'LO-5', lane: 'blocked', reason: 'Blocked by LO-9, which is not finished' },
		]);
	});

	test('stamps every ticket with the given time when there are no live lanes', () => {
		const { settled, at } = setupSettled({
			outcomes: [
				queueOutcomeFixture({ ticket: queueTicketFixture({ number: 7 }) }),
				queueOutcomeFixture({ ticket: queueTicketFixture({ number: 8 }), ready: false, error: 'The type gate failed' }),
			],
			leftBehind: [
				{ identifier: 'LO-9', reason: 'Already merged; reconciled to Done', settled: true },
				{ identifier: 'LO-10', reason: 'Skipped: it carries two planning labels' },
			],
		});

		const tickets = toQueueBoardTickets({ settled, at });

		expect(tickets).toEqual([
			expect.objectContaining({ identifier: 'LO-7', enteredAt: '2026-09-10T12:00:00.000Z' }),
			expect.objectContaining({ identifier: 'LO-9', enteredAt: '2026-09-10T12:00:00.000Z' }),
			expect.objectContaining({ identifier: 'LO-8', enteredAt: '2026-09-10T12:00:00.000Z' }),
			expect.objectContaining({ identifier: 'LO-10', enteredAt: '2026-09-10T12:00:00.000Z' }),
		]);
	});

	test('puts an admitted ticket with no builder in Build Queue with its branch and worktree', () => {
		const { settled, live, at } = setupLive({
			pending: [queueTicketFixture({ number: 71, title: 'Drain the backlog' })],
			branchTemplate: 'queue/{ticket}-{slug}',
		});

		const tickets = toQueueBoardTickets({ settled, live, at });

		expect(tickets).toEqual([
			{
				identifier: 'LO-71',
				title: 'Drain the backlog',
				url: 'https://linear.app/lightsout/issue/LO-71',
				lane: 'build-queue',
				worker: 'direct',
				branch: 'queue/lo-71-drain-the-backlog',
				worktreePath: '/worktrees/app/queue/lo-71-drain-the-backlog',
				enteredAt: '2026-09-10T12:00:00.000Z',
			},
		]);
	});

	test('moves a build whose worker waits for an answer from Building to Blocked with the question', () => {
		const { settled, live, at } = setupLive({
			building: [
				{ ticket: queueTicketFixture({ number: 72 }), startedAt: '2026-09-10T11:00:00.000Z' },
				{ ticket: queueTicketFixture({ number: 73 }), startedAt: '2026-09-10T11:05:00.000Z' },
			],
			questions: new Map([['lo-73', 'Should the board keep an empty lane?']]),
		});

		const tickets = toQueueBoardTickets({ settled, live, at });

		expect(tickets).toEqual([
			expect.objectContaining({ identifier: 'LO-72', lane: 'building', buildStartedAt: '2026-09-10T11:00:00.000Z' }),
			expect.objectContaining({
				identifier: 'LO-73',
				lane: 'blocked',
				reason: 'Should the board keep an empty lane?',
				question: 'Should the board keep an empty lane?',
				buildStartedAt: '2026-09-10T11:05:00.000Z',
			}),
		]);
	});

	test("places the ship lane's queue, its current branch and held tickets in their own columns", () => {
		const { settled, live, at } = setupLive({
			readyToShip: [queueOutcomeFixture({ ticket: queueTicketFixture({ number: 74 }), branch: 'lo-74-ship-me', worktreePath: '/worktrees/app/lo-74-ship-me' })],
			shipping: queueOutcomeFixture({ ticket: queueTicketFixture({ number: 75 }), branch: 'lo-75-merging', worktreePath: '/worktrees/app/lo-75-merging' }),
			blocked: [{ identifier: 'LO-76', reason: 'Blocked by LO-99, which is not finished' }],
		});

		const tickets = toQueueBoardTickets({ settled, live, at });

		expect(tickets).toEqual([
			expect.objectContaining({ identifier: 'LO-74', lane: 'ship-queue', branch: 'lo-74-ship-me', worktreePath: '/worktrees/app/lo-74-ship-me' }),
			expect.objectContaining({ identifier: 'LO-75', lane: 'shipping-now', branch: 'lo-75-merging', worktreePath: '/worktrees/app/lo-75-merging' }),
			expect.objectContaining({ identifier: 'LO-76', lane: 'blocked', reason: 'Blocked by LO-99, which is not finished' }),
		]);
	});

	test('names the plan folder only for an auto-plan ticket', () => {
		const { settled, live, at } = setupLive({
			pending: [
				queueTicketFixture({ number: 77, title: 'Plan the board', worker: QueueWorker.AutoPlan }),
				queueTicketFixture({ number: 78, title: 'Build the board', worker: QueueWorker.Direct }),
			],
		});

		const tickets = toQueueBoardTickets({ settled, live, at });

		expect(tickets.map(({ identifier, branch, planName }) => ({ identifier, branch, planName }))).toEqual([
			{ identifier: 'LO-77', branch: 'lo-77-plan-the-board', planName: 'lo-77-plan-the-board' },
			{ identifier: 'LO-78', branch: 'lo-78-build-the-board', planName: undefined },
		]);
	});

	test("keeps a ticket's entry time while it stays in its lane", () => {
		const { settled, live, at } = setupLive({
			pending: [queueTicketFixture({ number: 79 })],
			building: [{ ticket: queueTicketFixture({ number: 80 }), startedAt: '2026-09-10T11:30:00.000Z' }],
			entered: new Map([
				['lo-79', { lane: QueueLane.BuildQueue, at: '2026-09-10T10:00:00.000Z' }],
				['lo-80', { lane: QueueLane.BuildQueue, at: '2026-09-10T10:00:00.000Z' }],
			]),
		});

		const tickets = toQueueBoardTickets({ settled, live, at });

		expect(tickets).toEqual([
			expect.objectContaining({ identifier: 'LO-79', lane: 'build-queue', enteredAt: '2026-09-10T10:00:00.000Z' }),
			expect.objectContaining({ identifier: 'LO-80', lane: 'building', enteredAt: '2026-09-10T12:00:00.000Z' }),
		]);
	});

	test('shows a ticket named by two records once, in the lane of the record that ranks higher', () => {
		const { settled, live, at } = setupLive({
			outcomes: [queueOutcomeFixture({ ticket: queueTicketFixture({ number: 81 }) })],
			pending: [queueTicketFixture({ number: 81, identifier: 'lo-81' })],
		});

		const tickets = toQueueBoardTickets({ settled, live, at });

		expect(tickets).toEqual([expect.objectContaining({ identifier: 'LO-81', lane: 'shipped' })]);
	});

	test.each([
		{ from: 0, top: 'a settled left-behind entry', lane: 'shipped' },
		{ from: 1, top: "the ship lane's branch", lane: 'shipping-now' },
		{ from: 2, top: 'a ready branch', lane: 'ship-queue' },
		{ from: 3, top: 'a build in flight', lane: 'building' },
		{ from: 4, top: 'an admitted ticket', lane: 'build-queue' },
	])('shows a ticket named by $top and every lower-ranked record once, in $lane', ({ from, lane }) => {
		const { settled, live, at } = setupRanked({ from });

		const tickets = toQueueBoardTickets({ settled, live, at });

		expect(tickets.map(({ identifier, lane: placed }) => ({ identifier, lane: placed }))).toStrictEqual([{ identifier: 'LO-60', lane }]);
	});

	test('keeps each lane in ledger order and the lanes in column order', () => {
		const { settled, live, at } = setupLive({
			outcomes: [
				queueOutcomeFixture({ ticket: queueTicketFixture({ number: 20 }) }),
				queueOutcomeFixture({ ticket: queueTicketFixture({ number: 21 }), ready: false, error: 'The test gate failed' }),
			],
			leftBehind: [{ identifier: 'LO-9', reason: 'Skipped: it carries two planning labels' }],
			pending: [queueTicketFixture({ number: 90 }), queueTicketFixture({ number: 12 }), queueTicketFixture({ number: 55 })],
			building: [
				{ ticket: queueTicketFixture({ number: 40 }), startedAt: '2026-09-10T11:00:00.000Z' },
				{ ticket: queueTicketFixture({ number: 62 }), startedAt: '2026-09-10T11:10:00.000Z' },
			],
			readyToShip: [queueOutcomeFixture({ ticket: queueTicketFixture({ number: 30 }) })],
			shipping: queueOutcomeFixture({ ticket: queueTicketFixture({ number: 31 }) }),
			blocked: [{ identifier: 'LO-3', reason: 'Blocked by LO-99, which is not finished' }],
			questions: new Map([['lo-62', 'Which schema should the board use?']]),
		});

		const tickets = toQueueBoardTickets({ settled, live, at });

		expect(tickets.map(({ identifier, lane }) => ({ identifier, lane }))).toStrictEqual([
			{ identifier: 'LO-90', lane: 'build-queue' },
			{ identifier: 'LO-12', lane: 'build-queue' },
			{ identifier: 'LO-55', lane: 'build-queue' },
			{ identifier: 'LO-40', lane: 'building' },
			{ identifier: 'LO-30', lane: 'ship-queue' },
			{ identifier: 'LO-31', lane: 'shipping-now' },
			{ identifier: 'LO-20', lane: 'shipped' },
			{ identifier: 'LO-21', lane: 'parked' },
			{ identifier: 'LO-9', lane: 'blocked' },
			{ identifier: 'LO-3', lane: 'blocked' },
			{ identifier: 'LO-62', lane: 'blocked' },
		]);
	});

	test("carries the ticket's title and link, and leaves them unset when the entry has none", () => {
		const { settled, live, at } = setupLive({
			pending: [queueTicketFixture({ number: 86, title: 'Show the board' })],
			leftBehind: [
				{ identifier: 'LO-87', reason: 'Its parked worktree names a ticket the tracker no longer returns' },
				{ identifier: 'LO-88', reason: 'Skipped: it carries two planning labels', title: 'Pick one label', url: 'https://linear.app/lightsout/issue/LO-88' },
			],
		});

		const tickets = toQueueBoardTickets({ settled, live, at });

		expect(tickets.map(({ identifier, title, url }) => ({ identifier, title, url }))).toEqual([
			{ identifier: 'LO-86', title: 'Show the board', url: 'https://linear.app/lightsout/issue/LO-86' },
			{ identifier: 'LO-87', title: undefined, url: undefined },
			{ identifier: 'LO-88', title: 'Pick one label', url: 'https://linear.app/lightsout/issue/LO-88' },
		]);
	});
});
