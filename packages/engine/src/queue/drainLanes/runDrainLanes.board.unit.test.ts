import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { getQueueBoardPath, QueueBoardRecorder, readQueueBoard } from '#src/queue/board/index.ts';
import type { LeftBehindTicket } from '#src/queue/common/types/LeftBehindTicket.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { WaveSelection } from '#src/queue/common/types/WaveSelection.ts';
import { createMainCheckoutSerializer } from '#src/queue/common/utils/createMainCheckoutSerializer.ts';
import { runDrainLanes } from '#src/queue/drainLanes/index.ts';
import { drainLaneOutcomeFixture as outcomeOf } from '#tests/helpers/drainLaneOutcomeFixture.ts';
import { setupDrainLanes } from '#tests/helpers/setupDrainLanes.ts';

/** Runs a task with no other main-checkout git mutation in flight. */
type SerializeMainCheckout = <Result>(params: { task: () => Promise<Result> }) => Promise<Result>;
type ShipParams = { outcome: TicketRunOutcome; serializeMainCheckout: SerializeMainCheckout };
type ScanParams = { attempted: Set<string> };
type ReconcileParams = { tickets: RunnableTicket[] };

// Mocked Imports
// -------------------------
const mockShipOneBranch = jest.fn<(params: ShipParams) => Promise<TicketRunOutcome>>();

jest.mock('#src/queue/shipOneBranch.ts', () => ({ shipOneBranch: (params: ShipParams) => mockShipOneBranch(params) }));
// -------------------------
const mockListNextWave = jest.fn<(params: ScanParams) => Promise<WaveSelection | QueueFailure>>();

jest.mock('#src/queue/ticketSelection/listNextWave.ts', () => ({ listNextWave: (params: ScanParams) => mockListNextWave(params) }));
// -------------------------
const mockReconcileMergedTickets = jest.fn<(params: ReconcileParams) => Promise<{ kept: RunnableTicket[]; leftBehind: LeftBehindTicket[] }>>();

jest.mock('#src/queue/ticketSelection/reconcileMergedTickets.ts', () => ({
	reconcileMergedTickets: (params: ReconcileParams) => mockReconcileMergedTickets(params),
}));
// -------------------------

const notStartedReason = 'not started: every slot was retired by a ticket parked on an unanswered question';

/** An ISO time, as the board stamps a build's start — the exact instant is the clock's, not the test's. */
const isoTime = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);

const setupLanes = (options: Omit<Parameters<typeof setupDrainLanes>[0], 'mocks' | 'serializeMainCheckout'> = {}) => {
	const lanes = setupDrainLanes({
		...options,
		serializeMainCheckout: createMainCheckoutSerializer(),
		mocks: { ship: mockShipOneBranch, scan: mockListNextWave, reconcile: mockReconcileMergedTickets },
	});
	const board = new QueueBoardRecorder({
		cwd: lanes.params.cwd,
		runId: lanes.params.runId,
		branchTemplate: lanes.params.settings.branchTemplate,
		onProgress: (message) => lanes.progress.push(message),
	});

	/** Where each ticket stands on the board once every write the drain has queued so far has landed, in the order the file lists them. */
	const boardPlaces = async () => {
		await board.flush();
		const recorded = await readQueueBoard({ cwd: lanes.params.cwd, runId: lanes.params.runId });

		return recorded?.tickets.map(({ identifier, lane, reason, buildStartedAt }) => ({ identifier, lane, reason, buildStartedAt }));
	};

	return { ...lanes, board, boardPlaces, drain: () => lanes.trackDrain(runDrainLanes({ ...lanes.params, board })) };
};

/** The same retired-slot drain, with a plain file where the runs folder should be, so every board write fails. */
const setupUnwritableBoard = () => {
	const lanes = setupLanes({ runnable: ['LO-1', 'LO-2'], maxParallel: 1 });

	mkdirSync(join(lanes.params.cwd, '.lightsout'));
	writeFileSync(join(lanes.params.cwd, '.lightsout', 'runs'), 'not a folder\n', 'utf8');

	return { lanes, boardPath: getQueueBoardPath({ cwd: lanes.params.cwd, runId: lanes.params.runId }) };
};

describe('runDrainLanes', () => {
	test('records open builds in Building and the tickets they have not reached in Build Queue', async () => {
		const lanes = setupLanes({ runnable: ['LO-1', 'LO-2', 'LO-3'], maxParallel: 2 });

		const drained = lanes.drain();
		await lanes.builds.untilStarted({ identifier: 'LO-2' });
		const whileTwoBuild = await lanes.boardPlaces();
		await lanes.finishEverything();
		await drained;

		expect(whileTwoBuild).toEqual([
			{ identifier: 'LO-3', lane: 'build-queue', buildStartedAt: undefined },
			{ identifier: 'LO-1', lane: 'building', buildStartedAt: isoTime },
			{ identifier: 'LO-2', lane: 'building', buildStartedAt: isoTime },
		]);
	});

	test('moves a built branch through Ship Queue and Shipping Now into Shipped', async () => {
		const lanes = setupLanes({ runnable: ['LO-1', 'LO-2'], maxParallel: 2 });

		const drained = lanes.drain();
		await lanes.finishBuild({ identifier: 'LO-1' });
		await lanes.finishBuild({ identifier: 'LO-2' });
		await lanes.merges.untilStarted({ identifier: 'LO-1' });
		const whileTheFirstMerges = await lanes.boardPlaces();
		await lanes.finishMerge({ identifier: 'LO-1' });
		await lanes.finishMerge({ identifier: 'LO-2' });
		await drained;
		const afterBothMerged = await lanes.boardPlaces();

		expect({ whileTheFirstMerges, afterBothMerged }).toEqual({
			whileTheFirstMerges: [
				{ identifier: 'LO-2', lane: 'ship-queue' },
				{ identifier: 'LO-1', lane: 'shipping-now' },
			],
			afterBothMerged: [
				{ identifier: 'LO-1', lane: 'shipped' },
				{ identifier: 'LO-2', lane: 'shipped' },
			],
		});
	});

	test('records a stopped build in Parked with its error', async () => {
		const lanes = setupLanes({ runnable: ['LO-1', 'LO-2'], maxParallel: 2 });

		const drained = lanes.drain();
		await lanes.finishBuild({ identifier: 'LO-1', end: 'failed', error: 'the gates went red' });
		const afterTheFailure = await lanes.boardPlaces();
		await lanes.finishEverything();
		await drained;

		expect(afterTheFailure).toEqual([
			{ identifier: 'LO-2', lane: 'building', buildStartedAt: isoTime },
			{ identifier: 'LO-1', lane: 'parked', reason: 'the gates went red' },
		]);
	});

	test('shows a ticket held by a blocker in Blocked while the drain runs', async () => {
		const lanes = setupLanes({ runnable: ['LO-1'], blocked: [{ identifier: 'LO-2', reason: 'blocked by LO-9' }] });

		const drained = lanes.drain();
		await lanes.builds.untilStarted({ identifier: 'LO-1' });
		const firstWrite = await lanes.boardPlaces();
		await lanes.finishEverything();
		await drained;

		expect(firstWrite).toEqual([
			{ identifier: 'LO-1', lane: 'building', buildStartedAt: isoTime },
			{ identifier: 'LO-2', lane: 'blocked', reason: 'blocked by LO-9' },
		]);
	});

	test("seeds the pre-drain left-behind entries into the board and keeps the report's order", async () => {
		const parkedEntry: LeftBehindTicket = {
			identifier: 'LO-7',
			title: 'Ticket LO-7',
			url: 'https://linear.app/lightsout/issue/LO-7',
			reason: 'its worktree holds a branch nobody has merged',
		};
		const mergedEntry: LeftBehindTicket = {
			identifier: 'LO-8',
			title: 'Ticket LO-8',
			url: 'https://linear.app/lightsout/issue/LO-8',
			reason: 'its worktree at /tmp/LO-8 held a branch already recorded merged, so the ticket was reconciled to done rather than resumed',
			settled: true,
		};
		const heldEntry: LeftBehindTicket = { identifier: 'LO-9', reason: 'blocked by LO-5' };
		const lanes = setupLanes({ runnable: ['LO-1'], blocked: [heldEntry], carriedLeftBehind: [parkedEntry, mergedEntry] });

		const drained = lanes.drain();
		await lanes.builds.untilStarted({ identifier: 'LO-1' });
		const firstWrite = await lanes.boardPlaces();
		await lanes.finishEverything();
		const report = await drained;

		expect({ firstWrite, leftBehind: report.leftBehind }).toEqual({
			firstWrite: [
				{ identifier: 'LO-1', lane: 'building', buildStartedAt: isoTime },
				{ identifier: 'LO-8', lane: 'shipped' },
				{ identifier: 'LO-7', lane: 'blocked', reason: 'its worktree holds a branch nobody has merged' },
				{ identifier: 'LO-9', lane: 'blocked', reason: 'blocked by LO-5' },
			],
			leftBehind: [parkedEntry, mergedEntry, heldEntry],
		});
	});

	test('shows a never-started ticket once, in Blocked, when the drain finishes', async () => {
		const lanes = setupLanes({ runnable: ['LO-1', 'LO-2'], maxParallel: 1 });

		const drained = lanes.drain();
		await lanes.finishBuild({ identifier: 'LO-1', end: 'unanswered', error: 'nobody answered the question' });
		const report = await drained;
		const finalBoard = await lanes.boardPlaces();

		expect({ finalBoard, leftBehind: report.leftBehind }).toEqual({
			finalBoard: [
				{ identifier: 'LO-1', lane: 'parked', reason: 'nobody answered the question' },
				{ identifier: 'LO-2', lane: 'blocked', reason: notStartedReason },
			],
			leftBehind: [{ identifier: 'LO-2', title: 'Ticket LO-2', url: 'https://linear.app/lightsout/issue/LO-70', reason: notStartedReason }],
		});
	});

	test('drains to the same report when every board write fails', async () => {
		const { lanes, boardPath } = setupUnwritableBoard();

		const drained = lanes.drain();
		await lanes.finishBuild({ identifier: 'LO-1', end: 'unanswered', error: 'nobody answered the question' });
		const report = await drained;
		await lanes.board.flush();
		const drainLines = lanes.progress.filter((line) => !line.includes(boardPath));
		const boardLines = lanes.progress.filter((line) => line.includes(boardPath));

		expect({ report, drainLines, boardLines }).toEqual({
			report: {
				outcomes: [outcomeOf({ identifier: 'LO-1', end: 'unanswered', error: 'nobody answered the question' })],
				leftBehind: [{ identifier: 'LO-2', title: 'Ticket LO-2', url: 'https://linear.app/lightsout/issue/LO-70', reason: notStartedReason }],
			},
			drainLines: [`LO-2 · ${notStartedReason}`],
			boardLines: expect.arrayContaining([expect.stringContaining(boardPath)]),
		});
	});
});
