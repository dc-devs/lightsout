import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { loadPlanningProgressBlock } from '#src/cli/common/progressBlock/loadPlanningProgressBlock.ts';
import { loadRunProgressBlock } from '#src/cli/common/progressBlock/loadRunProgressBlock.ts';
import { loadShippingProgressBlock } from '#src/cli/common/progressBlock/loadShippingProgressBlock.ts';
import { loadActiveTicketBlock } from '#src/cli/common/queueBoard/loadActiveTicketBlock.ts';
import type { PlanningProgress } from '#src/contracts/plan/progress/PlanningProgress.ts';
import { PlanningStep } from '#src/contracts/plan/progress/PlanningStep.ts';
import type { QueueBoardTicket } from '#src/contracts/queue/QueueBoardTicket.ts';
import { QueueLane } from '#src/contracts/queue/QueueLane.ts';
import type { RunManifest } from '#src/contracts/run/RunManifest.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { ShippingProgress } from '#src/contracts/ship/ShippingProgress.ts';
import { ShippingStepId } from '#src/contracts/ship/ShippingStepId.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';
import { seedWorkOrderRecord } from '#tests/helpers/seedWorkOrderRecord.ts';

/** Beyond any OS pid range — the live-process probe reports it dead. */
const deadPid = 999_999_999;

/** The one clock the binder and the expected blocks both read, so a live running row ticks to the same value in each. */
const pinnedNow = Date.parse('2026-09-10T10:30:00.000Z');

/** When the ticket's current build began. */
const buildStartedAt = '2026-09-10T10:00:00.000Z';

/** Ten minutes before the build began — a run from an earlier queue invocation. */
const beforeBuild = '2026-09-10T09:50:00.000Z';

/** The branch the ticket builds and ships. */
const branch = 'lo-9-board-links';

/** The ticket's work order — the folder its runs are filed in and its auto-plan session writes. */
const workOrderName = 'lo-9-board-links';

/** A second ticket the queue builds at the same time, whose runs share the repository's state directory. */
const otherWorkOrderName = 'lo-10-board-filters';

/** When the Shipping Now ticket entered the ship lane. */
const enteredShippingAt = '2026-09-10T10:20:00.000Z';

/**
 * Runs whose short ids and plan titles all differ, so each one's block reads
 * differently from every other's. A was updated after B although B was created
 * later, so a binder that took the latest update instead of the latest creation
 * shows the wrong one.
 */
const runs = {
	a: {
		runId: 'aaaa1111-run-a',
		plan: 'plans/run-a/plan.md',
		createdAt: '2026-09-10T10:02:00.000Z',
		updatedAt: '2026-09-10T10:25:00.000Z',
		status: RunStatus.Running,
	},
	b: {
		runId: 'bbbb2222-run-b',
		plan: 'plans/run-b/plan.md',
		createdAt: '2026-09-10T10:05:00.000Z',
		updatedAt: '2026-09-10T10:10:00.000Z',
		status: RunStatus.Passed,
	},
	c: {
		runId: 'cccc3333-run-c',
		plan: 'plans/run-c/plan.md',
		createdAt: '2026-09-10T10:04:00.000Z',
		updatedAt: '2026-09-10T10:06:00.000Z',
		status: RunStatus.Passed,
	},
	early: {
		runId: 'eeee0000-early',
		plan: 'plans/early/plan.md',
		createdAt: beforeBuild,
		updatedAt: '2026-09-10T10:28:00.000Z',
		status: RunStatus.Running,
	},
};

type SeededRun = (typeof runs)[keyof typeof runs];

const manifestOf = ({ runId, plan, createdAt, updatedAt, status }: SeededRun): Partial<RunManifest> & { runId: string } => ({
	runId,
	plan,
	createdAt,
	updatedAt,
	status,
	currentStep: status === RunStatus.Running ? 'implement' : null,
	steps: [{ id: 'implement', status, attempts: 1, durationMs: 60_000 }],
	stepOrder: ['implement', 'test'],
});

const ticketOf = (overrides: Partial<QueueBoardTicket> & Pick<QueueBoardTicket, 'lane' | 'enteredAt'>): QueueBoardTicket => ({
	identifier: 'LO-9',
	title: 'Board links',
	url: 'https://linear.app/lightsout/issue/LO-9',
	branch,
	...overrides,
});

/** A planning record with verify-facts passed, so a block drawn for any other plan folder reads differently. */
const planningRecord = (): PlanningProgress => ({
	name: workOrderName,
	updatedAt: '2026-09-10T10:08:00.000Z',
	steps: [
		{
			step: PlanningStep.VerifyFacts,
			status: RunStatus.Passed,
			attempts: 1,
			pid: deadPid,
			startedAt: '2026-09-10T10:06:00.000Z',
			finishedAt: '2026-09-10T10:08:00.000Z',
			durationMs: 120_000,
		},
	],
});

/** A live ship under this test's process, integrate passed and push running, begun at `startedAt`. */
const shippingRecord = ({ startedAt }: { startedAt: string }): ShippingProgress => ({
	branch,
	attempt: 1,
	maxAttempts: 3,
	pid: process.pid,
	startedAt,
	updatedAt: '2026-09-10T10:26:00.000Z',
	lastProgress: `pushing ${branch}`,
	steps: [
		{ id: ShippingStepId.Integrate, status: RunStatus.Passed, startedAt, durationMs: 60_000 },
		{ id: ShippingStepId.Push, status: RunStatus.Running, startedAt: '2026-09-10T10:26:00.000Z' },
	],
});

/**
 * A worktree holding the given runs filed under the ticket's own work order,
 * `otherTicketRuns` filed under a second ticket's work order in the same shared
 * state directory, an optional run lock and an optional planning record, plus
 * each seeded run's block as `loadRunProgressBlock` draws it — the lines the
 * binder must hand back untouched.
 */
const setupWorktree = async ({
	seeded = [],
	otherTicketRuns = [],
	lock,
	withPlanningRecord = false,
}: {
	seeded?: SeededRun[];
	otherTicketRuns?: SeededRun[];
	lock?: { runId: string; pid: number };
	withPlanningRecord?: boolean;
} = {}) => {
	jest.spyOn(Date, 'now').mockReturnValue(pinnedNow);

	const worktreePath = await freshCwd();
	const filed = [...seeded.map((run) => ({ run, folder: workOrderName })), ...otherTicketRuns.map((run) => ({ run, folder: otherWorkOrderName }))];

	await mkdir(join(worktreePath, '.lightsout'), { recursive: true });

	for (const { run, folder } of filed) {
		await seedRunDir({ cwd: worktreePath, manifest: { ...manifestOf(run), planName: `${folder}/001-board-links` } });
	}

	if (lock !== undefined) {
		await writeFile(join(worktreePath, '.lightsout', 'lock.json'), JSON.stringify({ ...lock, startedAt: buildStartedAt }), 'utf8');
	}

	if (withPlanningRecord) {
		const planDir = planWorkspaceFolder({ cwd: worktreePath, name: workOrderName });

		await mkdir(planDir, { recursive: true });
		await writeFile(join(planDir, 'planning-progress.json'), `${JSON.stringify(planningRecord(), null, '\t')}\n`, 'utf8');
	}

	const blocks: Record<string, string[]> = {};

	for (const { run } of filed) {
		const { lines } = await loadRunProgressBlock({ cwd: worktreePath, runId: run.runId });

		blocks[run.runId] = lines;
	}

	const planningBlock = await loadPlanningProgressBlock({ cwd: worktreePath, name: workOrderName });

	return { worktreePath, blocks, planningBlock };
};

/**
 * A worktree for the ticket the ship lane holds: its shipping record begun at
 * `shipStartedAt`, filed as `ship-progress.json` in the branch's ticket folder,
 * and an engine run beside it that a run binder would pick.
 * `onDisk: false` answers a worktree path that is not there at all.
 */
const setupShippingWorktree = async ({ shipStartedAt, onDisk = true }: { shipStartedAt: string; onDisk?: boolean }) => {
	jest.spyOn(Date, 'now').mockReturnValue(pinnedNow);

	const checkout = await freshCwd();
	const worktreePath = onDisk ? checkout : join(checkout, 'removed-worktree');

	if (onDisk) {
		const workOrderFolder = join(worktreePath, '.lightsout', 'work-orders', branch);

		// The shipping record is filed in the work order whose record stores the branch.
		seedWorkOrderRecord({ cwd: worktreePath, name: branch });

		await mkdir(workOrderFolder, { recursive: true });
		await writeFile(join(workOrderFolder, 'ship-progress.json'), `${JSON.stringify(shippingRecord({ startedAt: shipStartedAt }), null, '\t')}\n`, 'utf8');
		await seedRunDir({ cwd: worktreePath, manifest: manifestOf({ ...runs.b, createdAt: '2026-09-10T10:22:00.000Z' }) });
	}

	const shippingBlock = onDisk ? await loadShippingProgressBlock({ cwd: worktreePath, branch }) : [];

	return { worktreePath, shippingBlock };
};

describe('loadActiveTicketBlock', () => {
	test("shows the run the worktree's lock names while its process is alive", async () => {
		const { worktreePath, blocks } = await setupWorktree({ seeded: [runs.a, runs.b], lock: { runId: runs.a.runId, pid: process.pid } });
		const ticket = ticketOf({ lane: QueueLane.Building, enteredAt: buildStartedAt, buildStartedAt, worktreePath, workOrderName });

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toStrictEqual(blocks[runs.a.runId]);
	});

	test("shows the most recently created run when no live process holds the worktree's lock", async () => {
		const { worktreePath, blocks } = await setupWorktree({ seeded: [runs.a, runs.b], lock: { runId: runs.a.runId, pid: deadPid } });
		const ticket = ticketOf({ lane: QueueLane.Building, enteredAt: buildStartedAt, buildStartedAt, worktreePath, workOrderName });

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toStrictEqual(blocks[runs.b.runId]);
	});

	test("never shows a run created before the ticket's build started, even one the lock names", async () => {
		const { worktreePath, blocks } = await setupWorktree({ seeded: [runs.early, runs.c], lock: { runId: runs.early.runId, pid: process.pid } });
		const ticket = ticketOf({ lane: QueueLane.Building, enteredAt: buildStartedAt, buildStartedAt, worktreePath, workOrderName });

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toStrictEqual(blocks[runs.c.runId]);
	});

	test('gives a one-line notice when no engine run has started in the worktree since the build began', async () => {
		const { worktreePath } = await setupWorktree({ seeded: [runs.early] });
		const ticket = ticketOf({ lane: QueueLane.Building, enteredAt: buildStartedAt, buildStartedAt, worktreePath, workOrderName });

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toEqual([expect.stringContaining(worktreePath)]);
	});

	test('shows the planning block for an auto-plan ticket that has no engine run yet', async () => {
		const { worktreePath, planningBlock } = await setupWorktree({ withPlanningRecord: true });
		const ticket = ticketOf({
			lane: QueueLane.Building,
			enteredAt: buildStartedAt,
			buildStartedAt,
			worktreePath,
			worker: QueueWorker.AutoPlan,
			workOrderName,
		});

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toStrictEqual(planningBlock);
	});

	test('shows the shipping block for the ticket the ship lane holds', async () => {
		const { worktreePath, shippingBlock } = await setupShippingWorktree({ shipStartedAt: '2026-09-10T10:21:00.000Z' });
		const ticket = ticketOf({ lane: QueueLane.ShippingNow, enteredAt: enteredShippingAt, worktreePath });

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toStrictEqual(shippingBlock);
	});

	test("loadActiveTicketBlock: shows a ticket's shipping steps from the record filed in its ticket folder", async () => {
		const { worktreePath } = await setupShippingWorktree({ shipStartedAt: '2026-09-10T10:21:00.000Z' });
		const ticket = ticketOf({ lane: QueueLane.ShippingNow, enteredAt: enteredShippingAt, worktreePath });

		const lines = await loadActiveTicketBlock({ ticket });

		// The steps the record holds, rather than the every-row-unreached block a
		// missing record draws: the worktree path is handed over as the checkout,
		// and the record is read from the branch's ticket folder.
		expect(lines).toEqual(expect.arrayContaining([expect.stringMatching(/integrate\s+passed/), expect.stringMatching(/push\s+running/)]));
	});

	test('gives a one-line notice for a shipping ticket whose worktree is no longer on disk', async () => {
		const { worktreePath } = await setupShippingWorktree({ shipStartedAt: '2026-09-10T10:21:00.000Z', onDisk: false });
		const ticket = ticketOf({ lane: QueueLane.ShippingNow, enteredAt: enteredShippingAt, worktreePath });

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toEqual([expect.stringContaining(worktreePath)]);
	});

	test('never shows a shipping record left by an earlier ship of the same branch', async () => {
		const { worktreePath } = await setupShippingWorktree({ shipStartedAt: '2026-09-10T09:40:00.000Z' });
		const ticket = ticketOf({ lane: QueueLane.ShippingNow, enteredAt: enteredShippingAt, worktreePath });

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toEqual([expect.stringMatching(/shipping now/i)]);
	});

	test('binds a question-waiting ticket from when its build started, not from when the wait began', async () => {
		const { worktreePath, blocks } = await setupWorktree({ seeded: [runs.b] });
		const ticket = ticketOf({
			lane: QueueLane.Blocked,
			enteredAt: '2026-09-10T10:15:00.000Z',
			buildStartedAt,
			worktreePath,
			workOrderName,
			reason: 'Which tracker field holds the link?',
			question: 'Which tracker field holds the link?',
		});

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toStrictEqual(blocks[runs.b.runId]);
	});

	test('gives a one-line notice when the board recorded no worktree for the ticket', async () => {
		const ticket = ticketOf({ lane: QueueLane.Building, enteredAt: buildStartedAt, buildStartedAt });

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toEqual([expect.stringMatching(/worktree/i)]);
	});

	test('two tickets building at once each show the run filed under their own work order', async () => {
		const { worktreePath, blocks } = await setupWorktree({ seeded: [runs.a], otherTicketRuns: [runs.b] });
		const ownTicket = ticketOf({ lane: QueueLane.Building, enteredAt: buildStartedAt, buildStartedAt, worktreePath, workOrderName });
		const otherTicket = ticketOf({
			identifier: 'LO-10',
			lane: QueueLane.Building,
			enteredAt: buildStartedAt,
			buildStartedAt,
			worktreePath,
			branch: otherWorkOrderName,
			workOrderName: otherWorkOrderName,
		});

		const [ownLines, otherLines] = await Promise.all([loadActiveTicketBlock({ ticket: ownTicket }), loadActiveTicketBlock({ ticket: otherTicket })]);

		expect({ ownLines, otherLines }).toStrictEqual({ ownLines: blocks[runs.a.runId], otherLines: blocks[runs.b.runId] });
	});

	test("gives the no-run notice when the only run since the build began is another ticket's", async () => {
		const { worktreePath } = await setupWorktree({ otherTicketRuns: [runs.b] });
		const ticket = ticketOf({ lane: QueueLane.Building, enteredAt: buildStartedAt, buildStartedAt, worktreePath, workOrderName });

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toEqual([expect.stringContaining(worktreePath)]);
	});

	test('gives a one-line notice when the board recorded no work order for the ticket', async () => {
		const { worktreePath } = await setupWorktree({ seeded: [runs.a] });
		const ticket = ticketOf({ lane: QueueLane.Building, enteredAt: buildStartedAt, buildStartedAt, worktreePath });

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toEqual([expect.stringMatching(/no work order.*LO-9/i)]);
	});
});
