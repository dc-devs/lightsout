import { writeFile } from 'node:fs/promises';
import { describe, expect, jest, test } from '@jest/globals';
import { statusCommand } from '#src/cli/statusCommand.ts';
import { PipelineKind, type QueueBoard, type QueueBoardTicket, QueueLane, type RunListing, RunStatus } from '#src/contracts/index.ts';
import { getQueueBoardPath } from '#src/queue/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';
import { usageFixture } from '#tests/helpers/usageFixture.ts';

/**
 * Which flag combinations `status --queue` accepts, and what it says about the
 * ones it refuses.
 *
 * A sibling of `statusCommand.queue.unit.test.ts` rather than more cases in it:
 * that file states what the command draws once a board is found, while every
 * case here is about the flags typed at it — none of them reaching a board's
 * blocks at all.
 */

// Mocked Imports
// -------------------------
// The helpers that own a clock: `resolveQueueRun` and `resolveWatchTarget` each
// wait a minute for a run, and `watchRunProgress` repaints every two minutes.
// The queue resolver answers with the run each case names; the other two keep a
// regression that falls through to the watch path from spending its minute.
// Everything else — board record, worktrees, progress records, rendering — is real.
type WatchTarget = { runId: string; rootRunId: string } | { ambiguous: string[] } | undefined;
interface QueueRunParams {
	cwd: string;
	runId?: string;
	wait?: boolean;
	graceMs?: number;
	pollMs?: number;
}

const mockResolveQueueRun = jest.fn<(params: QueueRunParams) => Promise<RunListing | undefined>>();
const mockResolveWatchTarget = jest.fn<(params: { cwd: string; rootRunId?: string }) => Promise<WatchTarget>>();
const mockWatchRunProgress = jest.fn<(params: { cwd: string; runId?: string; rootRunId?: string }) => Promise<void>>();

jest.mock('#src/cli/common/queueBoard/resolveQueueRun.ts', () => ({
	resolveQueueRun: (params: QueueRunParams) => mockResolveQueueRun(params),
}));
jest.mock('#src/cli/common/utils/resolveWatchTarget.ts', () => ({
	resolveWatchTarget: (params: { cwd: string; rootRunId?: string }) => mockResolveWatchTarget(params),
}));
jest.mock('#src/cli/common/utils/watchRunProgress.ts', () => ({
	watchRunProgress: (params: { cwd: string; runId?: string; rootRunId?: string }) => mockWatchRunProgress(params),
}));
// -------------------------

/** The coordinator run every case's queue board belongs to — a full id, so its first eight characters are what a report prints. */
const coordinatorRunId = 'c0ffee01-0000-4000-8000-000000000000';

/** The coordinator run's list row, as the resolver answers it — live and running unless a case says otherwise. */
const queueListingOf = ({ status = RunStatus.Running, live = true }: { status?: RunStatus; live?: boolean } = {}): RunListing => ({
	runId: coordinatorRunId,
	shortId: 'c0ffee01',
	pipeline: PipelineKind.Queue,
	status,
	title: 'queue',
	plan: `.lightsout/runs/${coordinatorRunId}/queue.md`,
	createdAt: '2026-09-10T08:55:00.000Z',
	updatedAt: '2026-09-10T09:30:00.000Z',
	live,
	packages: [],
	stepsPassed: 0,
	stepCount: 0,
	changedFileCount: 0,
	resumable: false,
});

/** A ticket waiting for a build worker: on the board, not active, so it needs no worktree. */
const waitingTicket: QueueBoardTicket = { identifier: 'EX-101', title: 'Notifications', lane: QueueLane.BuildQueue, enteredAt: '2026-09-10T08:56:00.000Z' };

const contextOf = ({ cwd, args }: { cwd: string; args: Record<string, string | true> }) => ({
	flags: new Map<string, string | true>(Object.entries(args)),
	rest: [],
	cwd,
});

/**
 * A real main checkout holding the coordinator run and its board, with the
 * resolver answering the given listing. Output is captured from here on.
 */
const setupQueue = async ({
	args = { queue: true },
	tickets = [waitingTicket],
	listing = queueListingOf(),
}: {
	args?: Record<string, string | true>;
	tickets?: QueueBoardTicket[];
	listing?: RunListing;
} = {}) => {
	const cwd = await freshCwd();
	const board: QueueBoard = { coordinatorRunId, updatedAt: '2026-09-10T09:30:00.000Z', tickets };

	await seedRunDir({ cwd, manifest: { runId: coordinatorRunId, pipeline: PipelineKind.Queue, status: listing.status } });
	await writeFile(await getQueueBoardPath({ cwd, runId: coordinatorRunId }), JSON.stringify(board), 'utf8');
	mockResolveQueueRun.mockResolvedValue(listing);
	mockResolveWatchTarget.mockResolvedValue(undefined);
	mockWatchRunProgress.mockResolvedValue(undefined);

	const captured = captureCommandOutput();

	return { context: contextOf({ cwd, args }), ...captured };
};

/** One live queue board, and one context per flag combination refused beside `--queue`, all landing in the same captured arrays. */
const setupRefusals = async () => {
	const combinations: Record<string, string | true>[] = [
		{ queue: true, watch: true },
		{ queue: true, planning: 'demo' },
		{ queue: true, shipping: 'lo-7-ship' },
	];
	const { context, logged, errors, exitCodes } = await setupQueue();
	const contexts = combinations.map((args) => ({ ...context, flags: new Map<string, string | true>(Object.entries(args)) }));

	return { contexts, logged, errors, exitCodes };
};

/**
 * Three live queue boards, each in its own checkout: one asked to wait, one
 * not, and one carrying a value after `--wait`. The last capture holds the
 * spies, so running the three contexts in order fills one set of arrays.
 */
const setupWaitForms = async () => {
	const waited = await setupQueue({ args: { queue: true, wait: true } });
	const bare = await setupQueue({ args: { queue: true } });
	const { context: valued, logged, errors, exitCodes } = await setupQueue({ args: { queue: true, wait: 'abc' } });

	return { bare: bare.context, errors, exitCodes, logged, valued, waited: waited.context };
};

/** One live queue board, and one context per form `--wait` is refused beside, all landing in the same captured arrays. */
const setupWaitWithoutQueue = async () => {
	const combinations: Record<string, string | true>[] = [
		{ wait: true },
		{ run: coordinatorRunId, wait: true },
		{ now: true, wait: true },
		{ planning: 'demo', wait: true },
		{ shipping: 'lo-7-ship', wait: true },
	];
	const { context, logged, errors, exitCodes } = await setupQueue();
	const contexts = combinations.map((args) => ({ ...context, flags: new Map<string, string | true>(Object.entries(args)) }));

	return { contexts, logged, errors, exitCodes };
};

describe('statusCommand --queue', () => {
	test('--queue with a --run matching nothing says so on stderr and exits 1', async () => {
		const { context, logged, errors, exitCodes } = await setupQueue({ args: { queue: true, run: 'ghost' } });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual([]);
		expect(errors).toEqual([expect.stringContaining("no run matching 'ghost'")]);
		expect(exitCodes).toStrictEqual([1]);
		expect(mockResolveQueueRun).not.toHaveBeenCalled();
	});

	test('refuses --queue beside --watch, --planning or --shipping with the usage text and exit 1', async () => {
		const { contexts, logged, errors, exitCodes } = await setupRefusals();

		const commands = contexts.map((context) => statusCommand(context));
		const outcomes = await Promise.allSettled(commands);

		expect(outcomes).toEqual([
			{ status: 'rejected', reason: expect.objectContaining({ message: 'process.exit' }) },
			{ status: 'rejected', reason: expect.objectContaining({ message: 'process.exit' }) },
			{ status: 'rejected', reason: expect.objectContaining({ message: 'process.exit' }) },
		]);
		// the board, a watch frame, the planning block or the shipping block would each have logged here
		expect(logged).toStrictEqual([]);
		expect(errors).toStrictEqual([usageFixture, usageFixture, usageFixture]);
		expect(exitCodes).toStrictEqual([1, 1, 1]);
		expect(mockResolveQueueRun).not.toHaveBeenCalled();
		expect(mockResolveWatchTarget).not.toHaveBeenCalled();
		expect(mockWatchRunProgress).not.toHaveBeenCalled();
	});

	test('refuses a value after --queue with the usage text and exit 1', async () => {
		const { context, logged, errors, exitCodes } = await setupQueue({ args: { queue: 'abc' } });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual([]);
		expect(errors).toStrictEqual([usageFixture]);
		expect(exitCodes).toStrictEqual([1]);
		expect(mockResolveQueueRun).not.toHaveBeenCalled();
	});

	test('--wait reaches the queue resolver only when it is typed, and a value after it is refused', async () => {
		const { bare, errors, exitCodes, logged, valued, waited } = await setupWaitForms();

		for (const context of [waited, bare, valued]) {
			await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);
		}

		expect(mockResolveQueueRun).toHaveBeenNthCalledWith(1, expect.objectContaining({ cwd: waited.cwd, wait: true }));
		expect(mockResolveQueueRun).toHaveBeenNthCalledWith(2, expect.objectContaining({ cwd: bare.cwd }));
		expect(mockResolveQueueRun).not.toHaveBeenCalledWith(expect.objectContaining({ cwd: bare.cwd, wait: true }));
		// the third form never reaches the resolver: a value after --wait is refused first
		expect(mockResolveQueueRun).toHaveBeenCalledTimes(2);
		expect(logged.some((line) => line.includes('EX-101 · Notifications'))).toBe(true);
		expect(errors).toStrictEqual([usageFixture]);
		expect(exitCodes).toStrictEqual([0, 0, 1]);
	});

	test('--wait without --queue prints the usage text and exits 1', async () => {
		const { contexts, logged, errors, exitCodes } = await setupWaitWithoutQueue();

		const outcomes = await Promise.allSettled(contexts.map((context) => statusCommand(context)));

		expect(outcomes.map(({ status }) => status)).toStrictEqual(['rejected', 'rejected', 'rejected', 'rejected', 'rejected']);
		// the listing, a run block, the one-shot block, the planning block or the shipping block would each have logged here
		expect(logged).toStrictEqual([]);
		expect(errors).toStrictEqual([usageFixture, usageFixture, usageFixture, usageFixture, usageFixture]);
		expect(exitCodes).toStrictEqual([1, 1, 1, 1, 1]);
		expect(mockResolveQueueRun).not.toHaveBeenCalled();
		expect(mockResolveWatchTarget).not.toHaveBeenCalled();
		expect(mockWatchRunProgress).not.toHaveBeenCalled();
	});
});
