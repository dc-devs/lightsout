import { describe, expect, jest, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { QueueBoardRecorder } from '#src/queue/board/index.ts';
import { drainQueue } from '#src/queue/drainQueue.ts';
import type { QueueDrainReport, TicketRunOutcome } from '#src/queue/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';
import { shipIntegrationFixture } from '#tests/helpers/shipIntegrationFixture.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

type LeftBehindTicket = QueueDrainReport['leftBehind'][number];
type SettleMergedTreesParams = Parameters<typeof import('#src/queue/common/utils/settleMergedTrees.ts').settleMergedTrees>[0];
type RunDrainLanesParams = Parameters<typeof import('#src/queue/drainLanes/index.ts').runDrainLanes>[0];

// Mocked Imports
// -------------------------
// Settling the merged trees and running the lanes each have their own tests.
// What this file owns is the hand-off between them: which pre-drain entries the
// drain is given, in what order, and what comes back out.
const mockSettleMergedTrees = jest.fn<(params: SettleMergedTreesParams) => Promise<LeftBehindTicket[]>>();

jest.mock('#src/queue/common/utils/settleMergedTrees.ts', () => ({
	settleMergedTrees: (params: SettleMergedTreesParams) => mockSettleMergedTrees(params),
}));
// -------------------------
const mockRunDrainLanes = jest.fn<(params: RunDrainLanesParams) => Promise<QueueDrainReport>>();

jest.mock('#src/queue/drainLanes/index.ts', () => ({
	runDrainLanes: (params: RunDrainLanesParams) => mockRunDrainLanes(params),
}));
// -------------------------

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

/** Runs the task at once — nothing else touches the main checkout in these cases. */
const serializeMainCheckout = <Result>({ task }: { task: () => Promise<Result> }) => task();

/**
 * A parked scan holding one left-behind entry and one merged tree, a merged-tree
 * settler that turns that tree into its own entry, and a drain that answers with
 * one entry of its own — three entries a test can tell apart by identifier.
 */
const setupDrainQueue = () => {
	const cwd = '/repo';
	const runId = 'queue-run-1';
	const settings = queueSettingsFixture();
	const parkedEntry: LeftBehindTicket = {
		identifier: 'LO-81',
		reason: 'its worktree holds a branch no ticket names',
		title: 'Ticket 81',
		url: 'https://linear.app/lightsout/issue/LO-81',
	};
	const mergedEntry: LeftBehindTicket = {
		identifier: 'LO-82',
		reason: 'its worktree held a branch already recorded merged, so the ticket was reconciled to done rather than resumed',
		title: 'Ticket 82',
		url: 'https://linear.app/lightsout/issue/LO-82',
		settled: true,
	};
	const drained: QueueDrainReport = {
		outcomes: [],
		leftBehind: [{ identifier: 'LO-83', reason: 'held back until LO-80 finishes' }],
	};
	const board = new QueueBoardRecorder({ cwd, runId, branchTemplate: settings.branchTemplate });
	const runTicket = jest.fn<(params: { ticket: ReturnType<typeof queueTicketFixture> }) => Promise<TicketRunOutcome>>();

	mockSettleMergedTrees.mockResolvedValue([mergedEntry]);
	mockRunDrainLanes.mockResolvedValue(drained);

	const params = {
		cwd,
		runId,
		holds: {},
		settings,
		trackerSettings: trackerSettingsFixture(),
		shipSettings: shipSettingsFixture(),
		shipIntegration: shipIntegrationFixture(),
		config,
		env: {},
		defaultBranch: 'main',
		planPath: '/repo/.lightsout/runs/queue-run-1/queue.md',
		first: { runnable: [], blocked: [], skipped: [] },
		parked: {
			resumed: [],
			outcomes: [],
			leftBehind: [parkedEntry],
			merged: [{ worktreePath: '/repo-worktrees/lo-82-drain', branch: 'lo-82-drain', ticket: queueTicketFixture({ number: 82 }) }],
		},
		runTicket,
		serializeMainCheckout,
		board,
	};

	return { params, board, parkedEntry, mergedEntry, drained };
};

describe('drainQueue', () => {
	test('hands the drain the parked and merged left-behind entries in order and returns its report as it is', async () => {
		const { params, board, parkedEntry, mergedEntry, drained } = setupDrainQueue();

		const report = await drainQueue(params);

		const handed = mockRunDrainLanes.mock.calls[0]?.[0];
		expect(handed?.carriedLeftBehind).toStrictEqual([parkedEntry, mergedEntry]);
		expect(handed?.board).toBe(board);
		expect(report).toStrictEqual(drained);
	});
});
