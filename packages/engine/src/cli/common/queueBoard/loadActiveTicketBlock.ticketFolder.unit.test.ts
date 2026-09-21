import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { loadPlanningProgressBlock } from '#src/cli/common/progressBlock/loadPlanningProgressBlock.ts';
import { loadActiveTicketBlock } from '#src/cli/common/queueBoard/loadActiveTicketBlock.ts';
import { type PlanningProgress, PlanningStep, type QueueBoardTicket, QueueLane, RunStatus } from '#src/contracts/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

/**
 * The block a ticket whose plan folder is a ticket folder gets: the plan the
 * record says is still being planned, rather than the folder that holds it.
 *
 * A sibling of `loadActiveTicketBlock.unit.test.ts` rather than more cases in
 * it: every case here builds a `ticket.json` and reads the block drawn for a
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
const planName = 'lo-9-board-links';

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

/** The plans a ticket record holds when the board's `planName` names a ticket folder rather than a legacy plan folder. */
const firstPlanId = '001-board-links';
const secondPlanId = '002-link-hover';

/** The address of the plan inside that ticket folder an auto-plan session writes. */
const planAddress = `${planName}/${secondPlanId}`;

/**
 * A ticket record the contract accepts, written by hand so the binder is the
 * only thing under test: plan 001 implemented, and plan 002 still being planned
 * only when the case asks for one.
 */
const ticketRecordOf = ({ withPlanToPlan }: { withPlanToPlan: boolean }) => ({
	schemaVersion: 1,
	ticketRef: 'LO-9',
	branch: planName,
	mode: 'multiple-plan',
	plans: [
		{ id: firstPlanId, title: 'Board links', progress: 'implemented', createdAt: '2026-09-10T09:00:00.000Z' },
		...(withPlanToPlan ? [{ id: secondPlanId, title: 'Link hover', progress: 'planning', createdAt: '2026-09-10T10:00:00.000Z' }] : []),
	],
	history: [{ at: '2026-09-10T09:00:00.000Z', kind: 'plan-added', detail: `added plan ${firstPlanId}` }],
});

/**
 * A worktree whose plan folder is a ticket folder: it holds `ticket.json`, and
 * the planning record of the plan still being planned sits in that plan's own
 * subfolder. It answers both the block drawn for the plan's address and the
 * block drawn for the ticket folder itself, which read differently, so a test
 * can say which one the binder chose.
 */
const setupTicketFolderWorktree = async ({ withPlanToPlan }: { withPlanToPlan: boolean }) => {
	jest.spyOn(Date, 'now').mockReturnValue(pinnedNow);

	const worktreePath = await freshCwd();
	const ticketFolder = join(worktreePath, '.lightsout', 'tickets', planName);

	await mkdir(ticketFolder, { recursive: true });
	await writeFile(join(ticketFolder, 'ticket.json'), `${JSON.stringify(ticketRecordOf({ withPlanToPlan }), null, '\t')}\n`, 'utf8');

	if (withPlanToPlan) {
		const planDir = join(ticketFolder, secondPlanId);

		await mkdir(planDir, { recursive: true });
		await writeFile(join(planDir, 'planning-progress.json'), `${JSON.stringify({ ...planningRecord(), name: planAddress }, null, '\t')}\n`, 'utf8');
	}

	const addressBlock = await loadPlanningProgressBlock({ cwd: worktreePath, name: planAddress });
	const ticketFolderBlock = await loadPlanningProgressBlock({ cwd: worktreePath, name: planName });

	return { worktreePath, addressBlock, ticketFolderBlock };
};

/**
 * The same ticket folder, holding a `ticket.json` the record contract refuses.
 *
 * A record that cannot be read is never the same thing as a folder with no
 * record: the second is a legacy plan folder, and reading the first as one would
 * draw a planning block for a plan nobody is writing.
 */
const setupUnreadableTicketFolder = async () => {
	jest.spyOn(Date, 'now').mockReturnValue(pinnedNow);

	const worktreePath = await freshCwd();
	const ticketFolder = join(worktreePath, '.lightsout', 'tickets', planName);

	await mkdir(ticketFolder, { recursive: true });
	await writeFile(join(ticketFolder, 'ticket.json'), '{ "schemaVersion": 1 }\n', 'utf8');

	return { worktreePath };
};

describe('loadActiveTicketBlock', () => {
	test("loadActiveTicketBlock: shows the planning block of the plan a ticket's auto-plan session is writing", async () => {
		const { worktreePath, addressBlock, ticketFolderBlock } = await setupTicketFolderWorktree({ withPlanToPlan: true });
		const ticket = ticketOf({ lane: QueueLane.Building, enteredAt: buildStartedAt, buildStartedAt, worktreePath, planName });

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toStrictEqual(addressBlock);
		expect(lines).not.toStrictEqual(ticketFolderBlock);
	});

	test('loadActiveTicketBlock: gives a notice when no plan in the ticket folder is waiting to be planned', async () => {
		const { worktreePath } = await setupTicketFolderWorktree({ withPlanToPlan: false });
		const ticket = ticketOf({ lane: QueueLane.Building, enteredAt: buildStartedAt, buildStartedAt, worktreePath, planName });

		const lines = await loadActiveTicketBlock({ ticket });

		expect(lines).toEqual([expect.stringContaining(planName)]);
	});

	test('gives a one-line notice naming the record file when the ticket folder holds one nothing can read', async () => {
		const { worktreePath } = await setupUnreadableTicketFolder();
		const ticket = ticketOf({ lane: QueueLane.Building, enteredAt: buildStartedAt, buildStartedAt, worktreePath, planName });

		const lines = await loadActiveTicketBlock({ ticket });

		// Never the ticket folder's own planning block: a record nothing can read
		// is not a legacy plan folder, and drawing one would show a plan record
		// for a plan nobody is writing.
		expect(lines).toEqual([expect.stringContaining(join('.lightsout', 'tickets', planName, 'ticket.json'))]);
	});
});
