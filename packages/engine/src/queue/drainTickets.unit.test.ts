import { describe, expect, test } from '@jest/globals';
import { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { drainTickets } from '#src/queue/drainTickets.ts';

const ticketOf = ({ number }: { number: number }): TicketSummary => ({
	id: `id-${number}`,
	identifier: `LO-${number}`,
	title: `Ticket ${number}`,
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: [],
	route: QueueRoute.Direct,
	unfinishedBlockers: [],
});

/** How one identifier's run is told to end: shipped-ready, plainly failed, or parked on a question nobody answered. */
type PlannedEnd = 'ready' | 'failed' | 'unanswered';

const outcomeOf = ({ ticket, end }: { ticket: TicketSummary; end: PlannedEnd }): TicketRunOutcome => ({
	ticket,
	branch: `${ticket.identifier.toLowerCase()}-work`,
	worktreePath: `/tmp/${ticket.identifier}`,
	ready: end === 'ready',
	error: end === 'ready' ? undefined : 'stopped',
	unanswered: end === 'unanswered' ? true : undefined,
});

/**
 * A ticket runner that resolves when told to, recording how many were in flight
 * at the moment each one started — which is the whole point of the slot budget.
 */
const setupRunner = ({ endOf = () => 'ready' }: { endOf?: (identifier: string) => PlannedEnd } = {}) => {
	const started: string[] = [];
	const release: (() => void)[] = [];
	let inFlight = 0;
	let peak = 0;

	const runTicket = ({ ticket }: { ticket: TicketSummary }) => {
		started.push(ticket.identifier);
		inFlight += 1;
		peak = Math.max(peak, inFlight);

		return new Promise<TicketRunOutcome>((resolve) => {
			release.push(() => {
				inFlight -= 1;
				resolve(outcomeOf({ ticket, end: endOf(ticket.identifier) }));
			});
		});
	};

	/** Let everything currently in flight finish, then give the drain a turn to start more. */
	const releaseAll = async () => {
		while (release.length > 0) {
			for (const done of release.splice(0)) {
				done();
			}

			await new Promise((resolve) => setImmediate(resolve));
		}
	};

	return { runTicket, releaseAll, started: () => started, peak: () => peak };
};

describe('drainTickets', () => {
	test('never holds more than the configured number of tickets in flight', async () => {
		const runner = setupRunner();
		const drained = drainTickets({ queued: [1, 2, 3, 4].map((number) => ticketOf({ number })), maxParallel: 2, runTicket: runner.runTicket });

		await runner.releaseAll();

		const { outcomes, leftBehind } = await drained;

		expect(runner.peak()).toBe(2);
		expect(outcomes).toHaveLength(4);
		expect(leftBehind).toStrictEqual([]);
	});

	test('refills a slot a shipped ticket frees, so the queue keeps moving', async () => {
		const runner = setupRunner();
		const drained = drainTickets({ queued: [1, 2, 3].map((number) => ticketOf({ number })), maxParallel: 1, runTicket: runner.runTicket });

		await runner.releaseAll();
		await drained;

		expect(runner.started()).toStrictEqual(['LO-1', 'LO-2', 'LO-3']);
	});

	test('a failed ticket frees its slot too — a crash holds no human, and must not slow the rest of the drain', async () => {
		const runner = setupRunner({ endOf: (identifier) => (identifier === 'LO-1' ? 'failed' : 'ready') });
		const drained = drainTickets({ queued: [1, 2, 3].map((number) => ticketOf({ number })), maxParallel: 1, runTicket: runner.runTicket });

		await runner.releaseAll();

		const { outcomes, leftBehind } = await drained;

		expect(runner.started()).toStrictEqual(['LO-1', 'LO-2', 'LO-3']);
		expect(outcomes).toHaveLength(3);
		expect(leftBehind).toStrictEqual([]);
	});

	test('retires the slot an unanswered question held — that is what caps how many questions can wait for the user at once', async () => {
		const runner = setupRunner({ endOf: (identifier) => (identifier === 'LO-1' ? 'unanswered' : 'ready') });
		const drained = drainTickets({ queued: [1, 2, 3].map((number) => ticketOf({ number })), maxParallel: 1, runTicket: runner.runTicket });

		await runner.releaseAll();

		const { outcomes, leftBehind } = await drained;

		expect(runner.started()).toStrictEqual(['LO-1']);
		expect(outcomes).toHaveLength(1);
		expect(leftBehind).toStrictEqual([
			{ identifier: 'LO-2', reason: 'not started: every slot was retired by a ticket parked on an unanswered question' },
			{ identifier: 'LO-3', reason: 'not started: every slot was retired by a ticket parked on an unanswered question' },
		]);
	});

	test('announces every ticket it never started, so nothing vanishes from the summary', async () => {
		const progress: string[] = [];
		const runner = setupRunner({ endOf: () => 'unanswered' });
		const drained = drainTickets({
			queued: [1, 2].map((number) => ticketOf({ number })),
			maxParallel: 1,
			runTicket: runner.runTicket,
			onProgress: (message) => progress.push(message),
		});

		await runner.releaseAll();
		await drained;

		expect(progress).toStrictEqual(['LO-2 · not started: every slot was retired by a ticket parked on an unanswered question']);
	});

	test('ends immediately on an empty queue, rather than waiting on a slot nothing will fill', async () => {
		const runner = setupRunner();

		expect(await drainTickets({ queued: [], maxParallel: 2, runTicket: runner.runTicket })).toStrictEqual({ outcomes: [], leftBehind: [] });
	});
});
