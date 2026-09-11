import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { QueueBoardState } from '#src/cli/common/constants/QueueBoardState.ts';
import { loadActiveTicketBlock } from '#src/cli/common/queueBoard/loadActiveTicketBlock.ts';
import { printQueueStatus } from '#src/cli/common/queueBoard/printQueueStatus.ts';
import { renderQueueBoard } from '#src/cli/common/queueBoard/renderQueueBoard.ts';
import { renderTicketDetailBlock } from '#src/cli/common/queueBoard/renderTicketDetailBlock.ts';
import { PipelineKind, type QueueBoard, type QueueBoardTicket, QueueLane, type RunListing, RunStatus } from '#src/contracts/index.ts';
import { getQueueBoardPath } from '#src/queue/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

// Mocked Imports
// -------------------------
// The one helper that owns a clock: `resolveQueueRun` waits up to a minute for
// a queue run to take the checkout's lock, and has its own test that drives
// that wait. What belongs here is what the printer does with the run it is
// handed. Everything else — the board record, the rendering, the per-ticket
// binder — is real.
type ResolveQueueRunParams = { cwd: string; runId?: string; graceMs?: number; pollMs?: number };

const mockResolveQueueRun = jest.fn<(params: ResolveQueueRunParams) => Promise<RunListing | undefined>>();

jest.mock('#src/cli/common/queueBoard/resolveQueueRun.ts', () => ({
	resolveQueueRun: (params: ResolveQueueRunParams) => mockResolveQueueRun(params),
}));
// -------------------------

/** The coordinator run every board in this file belongs to. */
const coordinatorRunId = 'run-queue-0001';

/** The clock every case runs under: local 10:20, so a live heading's time is known. */
const now = new Date(2026, 8, 10, 10, 20);

/** When the board record was last written: local 10:12, a different minute from `now`, so the two cannot be confused. */
const updatedAt = new Date(2026, 8, 10, 10, 12).toISOString();

/** The rows every board in this file opens with, as decision 18 states them. */
const headerRow = '| Build Queue | Building | Ship Queue | Shipping Now | Shipped | Parked | Blocked |';
const separatorRow = '| --- | --- | --- | --- | --- | --- | --- |';

/** A queue coordinator's row in the runs list: running, with a live process behind it. */
const listingOf = (overrides: Partial<RunListing> = {}): RunListing => ({
	runId: coordinatorRunId,
	shortId: 'run-queu',
	pipeline: PipelineKind.Queue,
	status: RunStatus.Running,
	title: 'queue',
	plan: '',
	createdAt: '2026-09-10T08:00:00.000Z',
	updatedAt,
	live: true,
	packages: [],
	stepsPassed: 0,
	stepCount: 0,
	changedFileCount: 0,
	resumable: false,
	...overrides,
});

/** The board's tickets, one per lane or state a case needs; none records a worktree, so each active block is the binder's notice. */
const tickets = {
	buildQueue: { identifier: 'EX-101', title: 'Notifications', lane: QueueLane.BuildQueue, enteredAt: '2026-09-10T09:00:00.000Z' },
	building: {
		identifier: 'EX-102',
		title: 'API changes',
		lane: QueueLane.Building,
		enteredAt: '2026-09-10T09:05:00.000Z',
		buildStartedAt: '2026-09-10T09:05:00.000Z',
	},
	shippingNow: {
		identifier: 'EX-104',
		title: 'Settings',
		lane: QueueLane.ShippingNow,
		branch: 'ex-104-settings',
		enteredAt: '2026-09-10T09:40:00.000Z',
	},
	shipped: { identifier: 'EX-106', title: 'Settings', lane: QueueLane.Shipped, enteredAt: '2026-09-10T09:50:00.000Z' },
	parked: { identifier: 'EX-107', title: 'Import fix', lane: QueueLane.Parked, enteredAt: '2026-09-10T09:30:00.000Z', reason: 'retry needed' },
	waiting: {
		identifier: 'EX-108',
		title: 'Migration',
		lane: QueueLane.Blocked,
		enteredAt: '2026-09-10T09:45:00.000Z',
		buildStartedAt: '2026-09-10T09:10:00.000Z',
		reason: 'Which lane comes first?',
		question: 'Which lane comes first?',
	},
	blocked: { identifier: 'EX-110', title: 'Deploy', lane: QueueLane.Blocked, enteredAt: '2026-09-10T09:15:00.000Z', reason: 'dependency' },
} satisfies Record<string, QueueBoardTicket>;

/**
 * A fresh main checkout under a frozen clock, the resolver answering `listing`,
 * and — when `boardTickets` is given — the board record the queue run wrote.
 * Only the clock is faked, so the file reads stay real.
 */
const setupQueueStatus = async ({ listing, boardTickets }: { listing: RunListing | undefined; boardTickets?: QueueBoardTicket[] }) => {
	jest.useFakeTimers({
		now,
		doNotFake: [
			'hrtime',
			'nextTick',
			'performance',
			'queueMicrotask',
			'requestAnimationFrame',
			'cancelAnimationFrame',
			'requestIdleCallback',
			'cancelIdleCallback',
			'setImmediate',
			'clearImmediate',
			'setInterval',
			'clearInterval',
			'setTimeout',
			'clearTimeout',
			'Temporal',
		],
	});
	mockResolveQueueRun.mockResolvedValue(listing);

	const cwd = await freshCwd();
	const boardPath = getQueueBoardPath({ cwd, runId: coordinatorRunId });

	if (boardTickets !== undefined) {
		const board: QueueBoard = { coordinatorRunId, updatedAt, tickets: boardTickets };

		mkdirSync(dirname(boardPath), { recursive: true });
		writeFileSync(boardPath, `${JSON.stringify(board, null, '\t')}\n`);
	}

	const captured = captureCommandOutput();

	return { cwd, boardPath, ...captured };
};

/**
 * A live queue run whose record lists its tickets out of column order, so a
 * printer that followed the record rather than the columns would show. The
 * expected output is the board the renderer draws at `now`, then the block the
 * binder answers for each active ticket, in column order.
 */
const setupLiveQueue = async () => {
	const boardTickets = [tickets.blocked, tickets.waiting, tickets.shippingNow, tickets.parked, tickets.building, tickets.buildQueue];
	const captured = await setupQueueStatus({ listing: listingOf(), boardTickets });
	const active = [tickets.building, tickets.shippingNow, tickets.waiting];
	const blocks = await Promise.all(active.map(async (ticket) => renderTicketDetailBlock({ ticket, lines: await loadActiveTicketBlock({ ticket }) })));
	const board = renderQueueBoard({ tickets: boardTickets, state: QueueBoardState.Live, at: now });

	return { ...captured, expected: [...board, ...blocks.flat()] };
};

describe('printQueueStatus', () => {
	test('prints the board first, then one block per active ticket in column order', async () => {
		const { cwd, logged, errors, expected } = await setupLiveQueue();

		const code = await printQueueStatus({ cwd });

		expect({ logged, errors, code }).toStrictEqual({ logged: expected, errors: [], code: 0 });
	});

	test('heads a queue run with no live process as stopped and shows no ticket as active', async () => {
		const { cwd, logged, errors } = await setupQueueStatus({
			listing: listingOf({ live: false, resumable: true }),
			boardTickets: [tickets.buildQueue, tickets.building, tickets.waiting],
		});

		const code = await printQueueStatus({ cwd, runId: coordinatorRunId });

		expect({ logged, errors, code }).toStrictEqual({
			logged: [
				'Queue stopped · last update 10:12',
				'',
				headerRow,
				separatorRow,
				'| EX-101 · Notifications | EX-102 · API changes | — | — | — | — | EX-108 · Migration — Which lane comes first? |',
			],
			errors: [],
			code: 0,
		});
	});

	test("heads a finished queue run with its board's last update and prints no block", async () => {
		const { cwd, logged, errors } = await setupQueueStatus({
			listing: listingOf({ status: RunStatus.Passed, live: false }),
			boardTickets: [tickets.building, tickets.shipped, tickets.parked],
		});

		const code = await printQueueStatus({ cwd, runId: coordinatorRunId });

		expect({ logged, errors, code }).toStrictEqual({
			logged: [
				'Queue finished · 10:12',
				'',
				headerRow,
				separatorRow,
				'| — | EX-102 · API changes | — | — | EX-106 · Settings | EX-107 · Import fix — retry needed | — |',
			],
			errors: [],
			code: 0,
		});
	});

	test('says no queue run is going when none is found, and answers 0', async () => {
		const { cwd, logged, errors } = await setupQueueStatus({ listing: undefined });

		const code = await printQueueStatus({ cwd });

		expect({ logged, errors, code }).toEqual({ logged: [expect.stringContaining(cwd)], errors: [], code: 0 });
	});

	test('names the board file when the queue run has not written one yet, and answers 0', async () => {
		const { cwd, boardPath, logged, errors } = await setupQueueStatus({ listing: listingOf() });

		const code = await printQueueStatus({ cwd });

		expect({ logged, errors, code }).toEqual({ logged: [expect.stringContaining(boardPath)], errors: [], code: 0 });
	});

	test('refuses a named run that is not a queue run with one line on stderr and answers 1', async () => {
		const { cwd, logged, errors } = await setupQueueStatus({
			listing: listingOf({
				runId: 'run-impl-0002',
				shortId: 'run-impl',
				pipeline: PipelineKind.Implement,
				status: RunStatus.Passed,
				live: false,
			}),
		});

		const code = await printQueueStatus({ cwd, runId: 'run-impl-0002' });

		expect({ logged, errors, code }).toEqual({ logged: [], errors: [expect.stringMatching(/^(?=.*run-impl)(?=.*queue)/i)], code: 1 });
	});
});
