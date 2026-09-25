import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { loadRunProgressBlock } from '#src/cli/internal/common/progressBlock/loadRunProgressBlock.ts';
import { loadActiveTicketBlock } from '#src/cli/internal/common/queueBoard/loadActiveTicketBlock.ts';
import type { QueueBoardTicket } from '#src/contracts/queue/QueueBoardTicket.ts';
import { QueueLane } from '#src/contracts/queue/QueueLane.ts';
import { PipelineKind } from '#src/contracts/run/PipelineKind.ts';
import type { RunManifest } from '#src/contracts/run/RunManifest.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { runDirFor } from '#tests/helpers/runDirFor.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';

/**
 * What a phased build's ticket shows on the board: its coordinator's overview
 * paired with the one phase child the reader should be looking at.
 *
 * A sibling of `loadActiveTicketBlock.unit.test.ts` rather than more cases in
 * it: that file states which single run a ticket binds to, while every case
 * here is about a run that has a parent — which is a second question, and the
 * only one that needs a coordinator seeded at all.
 */

/** Beyond any OS pid range — the live-process probe reports it dead. */
const deadPid = 999_999_999;

/** The one clock the binder and the expected blocks both read, so a live running row ticks to the same value in each. */
const pinnedNow = Date.parse('2026-09-10T10:30:00.000Z');

/** When the ticket's current build began. */
const buildStartedAt = '2026-09-10T10:00:00.000Z';

/** Ten minutes before the build began — a run from an earlier queue invocation. */
const beforeBuild = '2026-09-10T09:50:00.000Z';

/** The branch the ticket builds. */
const branch = 'lo-9-board-links';

/** The ticket's work order — the folder under the work-orders directory its runs are filed in. */
const workOrderName = branch;

/**
 * Phase children whose short ids and plan titles all differ, so each one's
 * block reads differently from every other's. A was updated after B although B
 * was created later, so a binder that took the latest update instead of the
 * latest creation shows the wrong one.
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
};

type SeededRun = (typeof runs)[keyof typeof runs] & { parentRunId?: string; pipeline?: PipelineKind };

/** A phased build's coordinator: one step per phase, and the run every phase child in these cases names as its parent. */
const coordinatorRun: SeededRun = {
	runId: 'dddd4444-coord',
	plan: 'plans/phase-overview/plan.md',
	createdAt: '2026-09-10T10:01:00.000Z',
	updatedAt: '2026-09-10T10:29:00.000Z',
	status: RunStatus.Running,
	pipeline: PipelineKind.Phases,
};

/** A coordinator whose run directory holds a manifest that will not parse. */
const corruptCoordinatorRunId = 'ffff5555-corrupt';

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

/** A plan address inside the given work order, which files a seeded run under that work order's runs folder. */
const planAddressIn = ({ name }: { name: string }) => `${name}/001-board-links`;

/**
 * A worktree holding the given runs, filed under the ticket's own work order,
 * and an optional run lock, plus each seeded run's block as
 * `loadRunProgressBlock` draws it — the lines the binder must hand back
 * untouched.
 */
const setupWorktree = async ({
	seeded = [],
	lock,
	unreadable,
}: {
	seeded?: SeededRun[];
	lock?: { runId: string; pid: number };
	/** A run id whose directory holds a manifest that will not parse — the half-written coordinator the runs list skips in silence. */
	unreadable?: string;
} = {}) => {
	jest.spyOn(Date, 'now').mockReturnValue(pinnedNow);

	const worktreePath = await freshCwd();

	await mkdir(join(worktreePath, '.lightsout'), { recursive: true });

	for (const run of seeded) {
		await seedRunDir({
			cwd: worktreePath,
			manifest: { ...manifestOf(run), parentRunId: run.parentRunId, pipeline: run.pipeline, planName: planAddressIn({ name: workOrderName }) },
		});
	}

	if (unreadable !== undefined) {
		const runDir = runDirFor({ cwd: worktreePath, runId: unreadable, workOrderName });

		await mkdir(runDir, { recursive: true });
		await writeFile(join(runDir, 'manifest.json'), '{ "runId": "', 'utf8');
	}

	if (lock !== undefined) {
		await writeFile(join(worktreePath, '.lightsout', 'lock.json'), JSON.stringify({ ...lock, startedAt: buildStartedAt }), 'utf8');
	}

	const blocks: Record<string, string[]> = {};

	for (const run of seeded) {
		const { lines } = await loadRunProgressBlock({ cwd: worktreePath, runId: run.runId });

		blocks[run.runId] = lines;
	}

	return { worktreePath, blocks };
};

/** A second ticket the queue builds at the same time, whose runs share the repository's state directory. */
const otherWorkOrderName = 'lo-12-board-search';

/**
 * Another ticket's phased build: a coordinator and a running phase child, both
 * created after this ticket's own family, so a binder reading every work
 * order's runs picks this family as the newest.
 */
const otherCoordinatorRun: SeededRun = {
	runId: 'eeee6666-other-coord',
	plan: 'plans/other-overview/plan.md',
	createdAt: '2026-09-10T10:10:00.000Z',
	updatedAt: '2026-09-10T10:29:30.000Z',
	status: RunStatus.Running,
	pipeline: PipelineKind.Phases,
};

const otherPhaseRun: SeededRun = {
	runId: 'abab7777-other-phase',
	plan: 'plans/other-phase/plan.md',
	createdAt: '2026-09-10T10:12:00.000Z',
	updatedAt: '2026-09-10T10:29:45.000Z',
	status: RunStatus.Running,
	parentRunId: otherCoordinatorRun.runId,
};

/**
 * A worktree whose state directory files each seeded run under the work order
 * its plan address names, with a run lock, plus each run's block as
 * `loadRunProgressBlock` draws it.
 */
const setupWorkOrderFolders = async ({ seeded, lock }: { seeded: (SeededRun & { planName: string })[]; lock: { runId: string; pid: number } }) => {
	jest.spyOn(Date, 'now').mockReturnValue(pinnedNow);

	const worktreePath = await freshCwd();

	await mkdir(join(worktreePath, '.lightsout'), { recursive: true });

	for (const run of seeded) {
		await seedRunDir({
			cwd: worktreePath,
			manifest: { ...manifestOf(run), parentRunId: run.parentRunId, pipeline: run.pipeline, planName: run.planName },
		});
	}

	await writeFile(join(worktreePath, '.lightsout', 'lock.json'), JSON.stringify({ ...lock, startedAt: buildStartedAt }), 'utf8');

	const blocks: Record<string, string[]> = {};

	for (const run of seeded) {
		const { lines } = await loadRunProgressBlock({ cwd: worktreePath, runId: run.runId });

		blocks[run.runId] = lines;
	}

	return { worktreePath, blocks };
};

describe('loadActiveTicketBlock', () => {
	test('a phased build shows the coordinator block and the going phase child block, separated by one blank line', async () => {
		const parent = coordinatorRun.runId;
		const going = { ...runs.a, parentRunId: parent };
		const { worktreePath, blocks } = await setupWorktree({
			seeded: [coordinatorRun, going, { ...runs.b, parentRunId: parent, updatedAt: '2026-09-10T10:27:00.000Z' }],
			lock: { runId: going.runId, pid: process.pid },
		});
		const ticket = ticketOf({ lane: QueueLane.Building, enteredAt: buildStartedAt, buildStartedAt, worktreePath, workOrderName });

		const lines = await loadActiveTicketBlock({ ticket });

		// The phase that is going wins over a sibling updated more recently, and
		// the coordinator's overview is no longer dropped in its favour.
		expect(lines).toStrictEqual([...blocks[coordinatorRun.runId], '', ...blocks[going.runId]]);
	});

	test('between phases a building ticket still shows the coordinator paired with its most recent phase child', async () => {
		const parent = coordinatorRun.runId;
		const recent = { ...runs.c, parentRunId: parent, updatedAt: '2026-09-10T10:27:00.000Z' };
		const { worktreePath, blocks } = await setupWorktree({
			seeded: [coordinatorRun, recent, { ...runs.b, parentRunId: parent }],
			lock: { runId: parent, pid: deadPid },
		});
		const ticket = ticketOf({ lane: QueueLane.Building, enteredAt: buildStartedAt, buildStartedAt, worktreePath, workOrderName });

		const lines = await loadActiveTicketBlock({ ticket });

		// No phase is going, so the child shown is the one updated last — run B was
		// created later, which is a different question.
		expect(lines).toStrictEqual([...blocks[coordinatorRun.runId], '', ...blocks[recent.runId]]);
	});

	test("a phase child of a coordinator older than the build still shows its coordinator's block", async () => {
		const older = { ...coordinatorRun, createdAt: beforeBuild };
		const child = { ...runs.a, parentRunId: older.runId };
		const { worktreePath, blocks } = await setupWorktree({ seeded: [older, child] });
		const ticket = ticketOf({ lane: QueueLane.Building, enteredAt: buildStartedAt, buildStartedAt, worktreePath, workOrderName });

		const lines = await loadActiveTicketBlock({ ticket });

		// The created-since filter drops the coordinator from the run binding, so a
		// resumed sequence is reached by climbing from the child that survived it.
		expect(lines).toStrictEqual([...blocks[older.runId], '', ...blocks[child.runId]]);
	});

	test('a phase child whose coordinator manifest cannot be read still shows its own block', async () => {
		const orphan = { ...runs.a, parentRunId: corruptCoordinatorRunId };
		const { worktreePath, blocks } = await setupWorktree({ seeded: [orphan], unreadable: corruptCoordinatorRunId });
		const ticket = ticketOf({ lane: QueueLane.Building, enteredAt: buildStartedAt, buildStartedAt, worktreePath, workOrderName });

		const lines = await loadActiveTicketBlock({ ticket });

		// One half-written coordinator must not take the whole board down: the
		// phase the reader can see is still shown.
		expect(lines).toStrictEqual(blocks[orphan.runId]);
	});

	test("a phased build shows its own coordinator and phase child while another ticket's phase is newer", async () => {
		const own = { planName: planAddressIn({ name: workOrderName }) };
		const other = { planName: planAddressIn({ name: otherWorkOrderName }) };
		const ownChild = { ...runs.a, parentRunId: coordinatorRun.runId, ...own };
		const { worktreePath, blocks } = await setupWorkOrderFolders({
			seeded: [{ ...coordinatorRun, ...own }, ownChild, { ...otherCoordinatorRun, ...other }, { ...otherPhaseRun, ...other }],
			lock: { runId: coordinatorRun.runId, pid: deadPid },
		});
		const ticket = ticketOf({ lane: QueueLane.Building, enteredAt: buildStartedAt, buildStartedAt, worktreePath, workOrderName });

		const lines = await loadActiveTicketBlock({ ticket });

		// The other ticket's family was created later and its phase is going too,
		// but its runs sit in another work order's folder, which this ticket never reads.
		expect(lines).toStrictEqual([...blocks[coordinatorRun.runId], '', ...blocks[ownChild.runId]]);
	});
});
