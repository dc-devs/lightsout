import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { loadPlanningProgressBlock } from '#src/cli/common/progressBlock/loadPlanningProgressBlock.ts';
import { loadRunProgressBlock } from '#src/cli/common/progressBlock/loadRunProgressBlock.ts';
import { loadShippingProgressBlock } from '#src/cli/common/progressBlock/loadShippingProgressBlock.ts';
import { loadActiveTicketBlock } from '#src/cli/common/queueBoard/loadActiveTicketBlock.ts';
import {
	type PlanningProgress,
	PlanningStep,
	type QueueBoardTicket,
	QueueLane,
	type RunManifest,
	RunStatus,
	type ShippingProgress,
	ShippingStepId,
} from '#src/contracts/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';

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

/** The plan folder an auto-plan ticket's session writes, named for its branch. */
const planName = 'lo-9-board-links';

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
	name: planName,
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
 * A worktree holding the given runs, an optional run lock and an optional
 * planning record, plus each seeded run's block as `loadRunProgressBlock` draws
 * it — the lines the binder must hand back untouched.
 */
const setupWorktree = async ({
	seeded = [],
	lock,
	withPlanningRecord = false,
}: {
	seeded?: SeededRun[];
	lock?: { runId: string; pid: number };
	withPlanningRecord?: boolean;
} = {}) => {
	jest.spyOn(Date, 'now').mockReturnValue(pinnedNow);

	const worktreePath = await freshCwd();

	await mkdir(join(worktreePath, '.lightsout'), { recursive: true });

	for (const run of seeded) {
		await seedRunDir({ cwd: worktreePath, manifest: manifestOf(run) });
	}

	if (lock !== undefined) {
		await writeFile(join(worktreePath, '.lightsout', 'lock.json'), JSON.stringify({ ...lock, startedAt: buildStartedAt }), 'utf8');
	}

	if (withPlanningRecord) {
		const planDir = join(worktreePath, '.lightsout', 'plans', planName);

		await mkdir(planDir, { recursive: true });
		await writeFile(join(planDir, 'planning-progress.json'), `${JSON.stringify(planningRecord(), null, '\t')}\n`, 'utf8');
	}

	const blocks: Record<string, string[]> = {};

	for (const run of seeded) {
		const { lines } = await loadRunProgressBlock({ cwd: worktreePath, runId: run.runId });

		blocks[run.runId] = lines;
	}

	const planningBlock = await loadPlanningProgressBlock({ cwd: worktreePath, name: planName });

	return { worktreePath, blocks, planningBlock };
};

/**
 * A worktree for the ticket the ship lane holds: its shipping record begun at
 * `shipStartedAt`, and an engine run beside it that a run binder would pick.
 * `onDisk: false` answers a worktree path that is not there at all.
 */
const setupShippingWorktree = async ({ shipStartedAt, onDisk = true }: { shipStartedAt: string; onDisk?: boolean }) => {
	jest.spyOn(Date, 'now').mockReturnValue(pinnedNow);

	const checkout = await freshCwd();
	const worktreePath = onDisk ? checkout : join(checkout, 'removed-worktree');

	if (onDisk) {
		const progressDir = join(worktreePath, '.lightsout', 'ship', 'progress');

		await mkdir(progressDir, { recursive: true });
		await writeFile(join(progressDir, `${branch}.json`), `${JSON.stringify(shippingRecord({ startedAt: shipStartedAt }), null, '\t')}\n`, 'utf8');
		await seedRunDir({ cwd: worktreePath, manifest: manifestOf({ ...runs.b, createdAt: '2026-09-10T10:22:00.000Z' }) });
	}

	const shippingBlock = onDisk ? await loadShippingProgressBlock({ cwd: worktreePath, branch }) : [];

	return { worktreePath, shippingBlock };
};

describe('loadActiveTicketBlock', () => {
	test("shows the run the worktree's lock names while its process is alive", async () => {
		const { worktreePath, blocks } = await setupWorktree({ seeded: [runs.a, runs.b], lock: { runId: runs.a.runId, pid: process.pid } });
		const ticket = ticketOf({ lane: QueueLane.Building, enteredAt: buildStartedAt, buildStartedAt, worktreePath });

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toStrictEqual(blocks[runs.a.runId]);
	});

	test("shows the most recently created run when no live process holds the worktree's lock", async () => {
		const { worktreePath, blocks } = await setupWorktree({ seeded: [runs.a, runs.b], lock: { runId: runs.a.runId, pid: deadPid } });
		const ticket = ticketOf({ lane: QueueLane.Building, enteredAt: buildStartedAt, buildStartedAt, worktreePath });

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toStrictEqual(blocks[runs.b.runId]);
	});

	test("never shows a run created before the ticket's build started, even one the lock names", async () => {
		const { worktreePath, blocks } = await setupWorktree({ seeded: [runs.early, runs.c], lock: { runId: runs.early.runId, pid: process.pid } });
		const ticket = ticketOf({ lane: QueueLane.Building, enteredAt: buildStartedAt, buildStartedAt, worktreePath });

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toStrictEqual(blocks[runs.c.runId]);
	});

	test('gives a one-line notice when no engine run has started in the worktree since the build began', async () => {
		const { worktreePath } = await setupWorktree({ seeded: [runs.early] });
		const ticket = ticketOf({ lane: QueueLane.Building, enteredAt: buildStartedAt, buildStartedAt, worktreePath });

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toEqual([expect.stringContaining(worktreePath)]);
	});

	test('shows the planning block for an auto-plan ticket that has no engine run yet', async () => {
		const { worktreePath, planningBlock } = await setupWorktree({ withPlanningRecord: true });
		const ticket = ticketOf({ lane: QueueLane.Building, enteredAt: buildStartedAt, buildStartedAt, worktreePath, planName });

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toStrictEqual(planningBlock);
	});

	test('shows the shipping block for the ticket the ship lane holds', async () => {
		const { worktreePath, shippingBlock } = await setupShippingWorktree({ shipStartedAt: '2026-09-10T10:21:00.000Z' });
		const ticket = ticketOf({ lane: QueueLane.ShippingNow, enteredAt: enteredShippingAt, worktreePath });

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toStrictEqual(shippingBlock);
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
});
