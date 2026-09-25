import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { statusCommand } from '#src/cli/statusCommand.ts';
import type { PlanningProgress } from '#src/contracts/plan/progress/PlanningProgress.ts';
import { PlanningStep } from '#src/contracts/plan/progress/PlanningStep.ts';
import type { QueueBoard } from '#src/contracts/queue/QueueBoard.ts';
import type { QueueBoardTicket } from '#src/contracts/queue/QueueBoardTicket.ts';
import { QueueLane } from '#src/contracts/queue/QueueLane.ts';
import { PipelineKind } from '#src/contracts/run/PipelineKind.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { ShippingProgress } from '#src/contracts/ship/ShippingProgress.ts';
import { ShippingStepId } from '#src/contracts/ship/ShippingStepId.ts';
import type { RunListing } from '#src/contracts/views/RunListing.ts';
import { getQueueBoardPath } from '#src/queue/board/getQueueBoardPath.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';
import { seedWorkOrderRecord } from '#tests/helpers/seedWorkOrderRecord.ts';

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

/** When the ticket fixtures' builds began; every worktree record below is newer. */
const buildStartedAt = '2026-09-10T09:00:00.000Z';

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

/** A ticket waiting for a build worker, and one already shipped: both on the board, neither active, so neither needs a worktree. */
const waitingTicket: QueueBoardTicket = { identifier: 'EX-101', title: 'Notifications', lane: QueueLane.BuildQueue, enteredAt: '2026-09-10T08:56:00.000Z' };
const shippedTicket: QueueBoardTicket = { identifier: 'EX-106', title: 'Settings', lane: QueueLane.Shipped, enteredAt: '2026-09-10T09:20:00.000Z' };

/** A plan's planning record with every entry finished, so its block holds no clock that moves between two renders. */
const planningRecordOf = ({ name }: { name: string }): PlanningProgress => ({
	name,
	updatedAt: '2026-09-10T09:02:00.000Z',
	steps: [
		{
			step: PlanningStep.VerifyFacts,
			status: RunStatus.Passed,
			attempts: 1,
			pid: process.pid,
			startedAt: '2026-09-10T09:00:30.000Z',
			finishedAt: '2026-09-10T09:01:00.000Z',
			durationMs: 30_000,
		},
		{
			step: PlanningStep.Draft,
			status: RunStatus.Failed,
			attempts: 1,
			pid: process.pid,
			startedAt: '2026-09-10T09:01:00.000Z',
			finishedAt: '2026-09-10T09:02:00.000Z',
			durationMs: 60_000,
		},
	],
});

/** An ended ship of `lo-7-ship` that started after its ticket entered Shipping Now; ended, so no row holds a moving clock. */
const shippingRecord: ShippingProgress = {
	branch: 'lo-7-ship',
	attempt: 1,
	maxAttempts: 3,
	pid: process.pid,
	startedAt: '2026-09-10T09:10:00.000Z',
	updatedAt: '2026-09-10T09:13:00.000Z',
	endedAt: '2026-09-10T09:13:00.000Z',
	lastProgress: 'ship: checks failed on the pull request',
	steps: [
		{ id: ShippingStepId.Integrate, status: RunStatus.Passed, startedAt: '2026-09-10T09:10:00.000Z', durationMs: 30_000 },
		{ id: ShippingStepId.Push, status: RunStatus.Passed, startedAt: '2026-09-10T09:10:30.000Z', durationMs: 10_000 },
		{ id: ShippingStepId.PullRequest, status: RunStatus.Passed, startedAt: '2026-09-10T09:10:40.000Z', durationMs: 20_000 },
		{ id: ShippingStepId.Checks, status: RunStatus.Failed, startedAt: '2026-09-10T09:11:00.000Z', durationMs: 120_000 },
		{ id: ShippingStepId.Merge, status: RunStatus.Pending },
		{ id: ShippingStepId.Sync, status: RunStatus.Pending },
	],
};

const contextOf = ({ cwd, args }: { cwd: string; args: Record<string, string | true> }) => ({
	flags: new Map<string, string | true>(Object.entries(args)),
	rest: [],
	cwd,
});

/**
 * What `lightsout status` prints standalone in the given checkout, minus its
 * leading blank line. Only the command's own exit ends it quietly.
 */
const standaloneLines = async ({ cwd, args }: { cwd: string; args: Record<string, string | true> }) => {
	const { logged } = captureCommandOutput();

	await statusCommand(contextOf({ cwd, args })).catch((error: unknown) => {
		if (!(error instanceof Error && error.message === 'process.exit')) {
			throw error;
		}
	});

	return logged.slice(1);
};

/** The lines between the output's `text` fence and the fence that closes it. */
const fencedLines = ({ logged }: { logged: string[] }) => {
	const open = logged.indexOf('```text');

	return logged.slice(open + 1, logged.indexOf('```', open + 1));
};

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

/** A worktree with an empty runs folder — what a queue worker's checkout holds before its engine run writes anything. */
const setupWorktree = async () => {
	const worktree = await freshCwd();

	await mkdir(join(worktree, '.lightsout', 'runs'), { recursive: true });

	return worktree;
};

/** The id of the one engine run a Building ticket's worktree holds; its first eight characters tag the run block's title. */
const worktreeRunId = 'b1c2d3e4-0000-4000-8000-000000000000';

/** The id of a second ticket's run, filed in the same checkout under that ticket's own work order. */
const otherTicketRunId = 'e5f6a7b8-0000-4000-8000-000000000000';

/**
 * A live board whose one active ticket is Building, its work order folder holding one failed run created after the
 * build began, with no lock, so no live process holds it. `withOtherTicketsRun` also files a newer failed run under a
 * second ticket's work order in the same checkout. `expected` is `status --run` for the ticket's own run in that worktree.
 */
const setupBuildingTicket = async ({ withOtherTicketsRun = false }: { withOtherTicketsRun?: boolean } = {}) => {
	const worktree = await setupWorktree();
	const workOrderName = 'ex-102-api-changes';
	const failedRun = {
		status: RunStatus.Failed,
		steps: [{ id: 'implement', status: RunStatus.Failed, attempts: 1, durationMs: 180_000 }],
		stepOrder: ['implement', 'format'],
	};

	await seedRunDir({
		cwd: worktree,
		manifest: {
			...failedRun,
			runId: worktreeRunId,
			planName: `${workOrderName}/001-api-changes`,
			createdAt: '2026-09-10T09:01:00.000Z',
			updatedAt: '2026-09-10T09:04:00.000Z',
		},
	});

	if (withOtherTicketsRun) {
		await seedRunDir({
			cwd: worktree,
			manifest: {
				...failedRun,
				runId: otherTicketRunId,
				planName: 'ex-104-billing-changes/001-billing-changes',
				createdAt: '2026-09-10T09:05:00.000Z',
				updatedAt: '2026-09-10T09:08:00.000Z',
			},
		});
	}

	const expected = await standaloneLines({ cwd: worktree, args: { run: worktreeRunId } });
	const ticket: QueueBoardTicket = {
		identifier: 'EX-102',
		title: 'API changes',
		lane: QueueLane.Building,
		workOrderName,
		worktreePath: worktree,
		enteredAt: buildStartedAt,
		buildStartedAt,
	};
	const queue = await setupQueue({ tickets: [waitingTicket, ticket] });

	return { ...queue, expected };
};

/**
 * A live board whose one active ticket is an auto-plan ticket still Building, with no engine run in its worktree
 * and a planning record in its plan folder. `expected` is `status --planning` for that plan in that worktree.
 */
const setupAutoPlanTicket = async () => {
	const worktree = await setupWorktree();
	const workOrderName = 'ex-103-search-changes';
	const planDir = planWorkspaceFolder({ cwd: worktree, name: workOrderName });

	await mkdir(planDir, { recursive: true });
	await writeFile(join(planDir, 'planning-progress.json'), `${JSON.stringify(planningRecordOf({ name: workOrderName }), null, '\t')}\n`, 'utf8');

	const expected = await standaloneLines({ cwd: worktree, args: { planning: workOrderName } });
	const ticket: QueueBoardTicket = {
		identifier: 'EX-103',
		title: 'Search changes',
		lane: QueueLane.Building,
		worker: QueueWorker.AutoPlan,
		workOrderName,
		branch: workOrderName,
		worktreePath: worktree,
		enteredAt: buildStartedAt,
		buildStartedAt,
	};
	const queue = await setupQueue({ tickets: [waitingTicket, ticket] });

	return { ...queue, expected };
};

/**
 * A live board whose one active ticket is the branch the ship lane holds, its worktree holding the ship's record.
 * `expected` is `status --shipping` for that branch in that worktree.
 */
const setupShippingTicket = async () => {
	const worktree = await setupWorktree();
	const workOrderFolder = join(worktree, '.lightsout', 'work-orders', 'lo-7-ship');

	// The shipping record is filed in the work order whose record stores the branch.
	seedWorkOrderRecord({ cwd: worktree, name: 'lo-7-ship' });

	await mkdir(workOrderFolder, { recursive: true });
	await writeFile(join(workOrderFolder, 'ship-progress.json'), `${JSON.stringify(shippingRecord, null, '\t')}\n`, 'utf8');

	const expected = await standaloneLines({ cwd: worktree, args: { shipping: 'lo-7-ship' } });
	const ticket: QueueBoardTicket = {
		identifier: 'EX-105',
		title: 'Audit log',
		lane: QueueLane.ShippingNow,
		branch: 'lo-7-ship',
		worktreePath: worktree,
		enteredAt: '2026-09-10T09:09:00.000Z',
	};
	const queue = await setupQueue({ tickets: [waitingTicket, ticket] });

	return { ...queue, expected };
};

describe('statusCommand --queue', () => {
	test('a bare --queue follows the live queue run instead of listing runs', async () => {
		const { context, logged, errors, exitCodes } = await setupQueue();

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockResolveQueueRun).toHaveBeenCalledWith({ cwd: context.cwd });
		// the run listing would open with the coordinator run's own row here
		expect(logged[0]).toMatch(/^Queue update · \d{2}:\d{2} · next update \d{2}:\d{2}$/);
		expect(logged.some((line) => line.includes('EX-101 · Notifications'))).toBe(true);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('--queue --run takes the shortened id a report printed', async () => {
		const { context, logged, errors, exitCodes } = await setupQueue({
			args: { queue: true, run: 'c0ffee01' },
			tickets: [shippedTicket],
			listing: queueListingOf({ status: RunStatus.Passed, live: false }),
		});

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockResolveQueueRun).toHaveBeenCalledWith({ cwd: context.cwd, runId: coordinatorRunId });
		expect(logged[0]).toMatch(/^Queue finished · \d{2}:\d{2}$/);
		expect(logged.some((line) => line.includes('EX-106 · Settings'))).toBe(true);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test("a Building ticket's fenced lines equal status --run for the same worktree, line for line", async () => {
		const { context, expected, logged, exitCodes } = await setupBuildingTicket();

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(fencedLines({ logged })).toStrictEqual(expected);
		// the block is the worktree run's, not an empty answer both sides happen to share
		expect(expected[0]?.endsWith('b1c2d3e4')).toBe(true);
		expect(exitCodes).toStrictEqual([0]);
	});

	test("a Building ticket's fenced lines show its own run when another ticket's newer run shares the checkout", async () => {
		const { context, expected, logged, exitCodes } = await setupBuildingTicket({ withOtherTicketsRun: true });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(fencedLines({ logged })).toStrictEqual(expected);
		// the block is the ticket's own run, not the second ticket's newer one
		expect(expected[0]?.endsWith('b1c2d3e4')).toBe(true);
		expect(exitCodes).toStrictEqual([0]);
	});

	test("an auto-plan ticket's fenced lines equal status --planning for the same worktree, line for line", async () => {
		const { context, expected, logged, exitCodes } = await setupAutoPlanTicket();

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(fencedLines({ logged })).toStrictEqual(expected);
		// the block is the plan's record, not an empty answer both sides happen to share
		expect(expected[0]).toMatch(/^ex-103-search-changes +planning$/);
		expect(expected).toContain(' elapsed 1m 30s · 1 of 5 passed');
		expect(exitCodes).toStrictEqual([0]);
	});

	test("a shipping ticket's fenced lines equal status --shipping for the same worktree, line for line", async () => {
		const { context, expected, logged, exitCodes } = await setupShippingTicket();

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(fencedLines({ logged })).toStrictEqual(expected);
		// the block is the ship's record, not an empty answer both sides happen to share
		expect(expected[0]).toMatch(/^lo-7-ship /);
		expect(expected.at(-1)).toBe(' now  ship: checks failed on the pull request');
		expect(exitCodes).toStrictEqual([0]);
	});
});
