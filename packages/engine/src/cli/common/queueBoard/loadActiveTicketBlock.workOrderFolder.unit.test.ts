import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { loadPlanningProgressBlock } from '#src/cli/common/progressBlock/loadPlanningProgressBlock.ts';
import { loadActiveTicketBlock } from '#src/cli/common/queueBoard/loadActiveTicketBlock.ts';
import type { PlanningProgress } from '#src/contracts/plan/progress/PlanningProgress.ts';
import { PlanningStep } from '#src/contracts/plan/progress/PlanningStep.ts';
import type { QueueBoardTicket } from '#src/contracts/queue/QueueBoardTicket.ts';
import { QueueLane } from '#src/contracts/queue/QueueLane.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';

/**
 * The block a ticket whose plan folder is a ticket folder gets: the plan the
 * record says is still being planned, rather than the folder that holds it.
 *
 * A sibling of `loadActiveTicketBlock.unit.test.ts` rather than more cases in
 * it: every case here builds a `state.json` and reads the block drawn for a
 * plan address, while that file's cases are about which engine run, planning
 * record or shipping record a ticket binds to.
 */

/** Beyond any OS pid range — the live-process probe reports it dead. */
const deadPid = 999_999_999;

/** The one clock the binder and the expected blocks both read, so a live running row ticks to the same value in each. */
const pinnedNow = Date.parse('2026-09-10T10:30:00.000Z');

/** When the ticket's current build began. */
const buildStartedAt = '2026-09-10T10:00:00.000Z';

/** The branch the ticket builds and ships. */
const branch = 'lo-9-board-links';

/** The ticket folder the board records, named for the ticket's branch. */
const workOrderName = 'lo-9-board-links';

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

/** The plans a ticket record holds when the board's `workOrderName` names a ticket folder rather than a legacy plan folder. */
const firstPlanId = '001-board-links';
const secondPlanId = '002-link-hover';

/** The address of the plan inside that ticket folder an auto-plan session writes. */
const planAddress = `${workOrderName}/${secondPlanId}`;

/**
 * A ticket record the contract accepts, written by hand so the binder is the
 * only thing under test: plan 001 implemented, and plan 002 still being planned
 * only when the case asks for one.
 */
const ticketRecordOf = ({ withPlanToPlan }: { withPlanToPlan: boolean }) => ({
	schemaVersion: 1,
	name: workOrderName,
	ticketRef: 'LO-9',
	branch: workOrderName,
	mode: 'multiple-plan',
	plans: [
		{ id: firstPlanId, title: 'Board links', progress: 'implemented', createdAt: '2026-09-10T09:00:00.000Z' },
		...(withPlanToPlan ? [{ id: secondPlanId, title: 'Link hover', progress: 'planning', createdAt: '2026-09-10T10:00:00.000Z' }] : []),
	],
	history: [{ at: '2026-09-10T09:00:00.000Z', kind: 'plan-added', detail: `added plan ${firstPlanId}` }],
});

/**
 * A worktree whose plan folder is a ticket folder: it holds `state.json`, and
 * the planning record of the plan still being planned sits in that plan's own
 * subfolder. It answers both the block drawn for the plan's address and the
 * block drawn for the ticket folder itself, which read differently, so a test
 * can say which one the binder chose.
 */
const setupTicketFolderWorktree = async ({ withPlanToPlan }: { withPlanToPlan: boolean }) => {
	jest.spyOn(Date, 'now').mockReturnValue(pinnedNow);

	const worktreePath = await freshCwd();
	const workOrderFolder = join(worktreePath, '.lightsout', 'work-orders', workOrderName);

	await mkdir(workOrderFolder, { recursive: true });
	await writeFile(join(workOrderFolder, 'state.json'), `${JSON.stringify(ticketRecordOf({ withPlanToPlan }), null, '\t')}\n`, 'utf8');

	if (withPlanToPlan) {
		const planDir = join(workOrderFolder, secondPlanId);

		await mkdir(planDir, { recursive: true });
		await writeFile(join(planDir, 'planning-progress.json'), `${JSON.stringify({ ...planningRecord(), name: planAddress }, null, '\t')}\n`, 'utf8');
	}

	const addressBlock = await loadPlanningProgressBlock({ cwd: worktreePath, name: planAddress });
	const ticketFolderBlock = await loadPlanningProgressBlock({ cwd: worktreePath, name: workOrderName });

	return { worktreePath, addressBlock, ticketFolderBlock };
};

/**
 * The same ticket folder, holding a `state.json` the record contract refuses.
 *
 * A record that cannot be read is never the same thing as a folder with no
 * record: the second is a legacy plan folder, and reading the first as one would
 * draw a planning block for a plan nobody is writing.
 */
const setupUnreadableTicketFolder = async () => {
	jest.spyOn(Date, 'now').mockReturnValue(pinnedNow);

	const worktreePath = await freshCwd();
	const workOrderFolder = join(worktreePath, '.lightsout', 'work-orders', workOrderName);

	await mkdir(workOrderFolder, { recursive: true });
	await writeFile(join(workOrderFolder, 'state.json'), '{ "schemaVersion": 1 }\n', 'utf8');

	return { worktreePath };
};

/** A second ticket the queue builds at the same time, filed in a work order folder of its own. */
const otherWorkOrderName = 'lo-10-board-filters';

/**
 * The ticket folder with a plan still being planned, sharing its state
 * directory with another ticket's running run created since the build began —
 * every checkout of a repository resolves the same state directory, so a
 * reader that lists every run in it finds that run first.
 */
const setupBesideAnotherTicketsRun = async () => {
	const { worktreePath, addressBlock } = await setupTicketFolderWorktree({ withPlanToPlan: true });

	await seedRunDir({
		cwd: worktreePath,
		manifest: {
			runId: 'bbbb2222-other-ticket',
			planName: `${otherWorkOrderName}/001-board-filters`,
			plan: 'plans/board-filters/plan.md',
			createdAt: '2026-09-10T10:12:00.000Z',
			updatedAt: '2026-09-10T10:28:00.000Z',
			status: RunStatus.Running,
			currentStep: 'implement',
			steps: [{ id: 'implement', status: RunStatus.Running, attempts: 1, durationMs: 60_000 }],
			stepOrder: ['implement', 'test'],
		},
	});

	return { worktreePath, addressBlock };
};

describe('loadActiveTicketBlock', () => {
	test("loadActiveTicketBlock: shows the planning block of the plan a ticket's auto-plan session is writing", async () => {
		const { worktreePath, addressBlock, ticketFolderBlock } = await setupTicketFolderWorktree({ withPlanToPlan: true });
		const ticket = ticketOf({
			lane: QueueLane.Building,
			enteredAt: buildStartedAt,
			buildStartedAt,
			worktreePath,
			worker: QueueWorker.AutoPlan,
			workOrderName,
		});

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toStrictEqual(addressBlock);
		expect(lines).not.toStrictEqual(ticketFolderBlock);
	});

	test('loadActiveTicketBlock: gives a notice when no plan in the ticket folder is waiting to be planned', async () => {
		const { worktreePath } = await setupTicketFolderWorktree({ withPlanToPlan: false });
		const ticket = ticketOf({
			lane: QueueLane.Building,
			enteredAt: buildStartedAt,
			buildStartedAt,
			worktreePath,
			worker: QueueWorker.AutoPlan,
			workOrderName,
		});

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toEqual([expect.stringContaining(workOrderName)]);
	});

	test('gives a one-line notice naming the record file when the ticket folder holds one nothing can read', async () => {
		const { worktreePath } = await setupUnreadableTicketFolder();
		const ticket = ticketOf({
			lane: QueueLane.Building,
			enteredAt: buildStartedAt,
			buildStartedAt,
			worktreePath,
			worker: QueueWorker.AutoPlan,
			workOrderName,
		});

		const lines = await loadActiveTicketBlock({ ticket });

		// Never the ticket folder's own planning block: a record nothing can read
		// is not a legacy plan folder, and drawing one would show a plan record
		// for a plan nobody is writing.
		expect(lines).toEqual([expect.stringContaining(join('.lightsout', 'work-orders', workOrderName, 'state.json'))]);
	});

	test('gives the no-run notice rather than a planning block for a ticket whose worker is not auto-plan', async () => {
		const { worktreePath } = await setupTicketFolderWorktree({ withPlanToPlan: true });
		const ticket = ticketOf({
			lane: QueueLane.Building,
			enteredAt: buildStartedAt,
			buildStartedAt,
			worktreePath,
			worker: QueueWorker.Direct,
			workOrderName,
		});

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toEqual([expect.stringContaining(worktreePath)]);
	});

	test("shows an auto-plan ticket's planning block while another ticket's run is going", async () => {
		const { worktreePath, addressBlock } = await setupBesideAnotherTicketsRun();
		const ticket = ticketOf({
			lane: QueueLane.Building,
			enteredAt: buildStartedAt,
			buildStartedAt,
			worktreePath,
			worker: QueueWorker.AutoPlan,
			workOrderName,
		});

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toStrictEqual(addressBlock);
	});
});
