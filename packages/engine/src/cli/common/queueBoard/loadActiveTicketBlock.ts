import { loadPlanningProgressBlock } from '#src/cli/common/progressBlock/loadPlanningProgressBlock.ts';
import { loadRunProgressBlock } from '#src/cli/common/progressBlock/loadRunProgressBlock.ts';
import { loadShippingProgressBlock } from '#src/cli/common/progressBlock/loadShippingProgressBlock.ts';
import { formatPlanAddress } from '#src/common/planAddress/formatPlanAddress.ts';
import { type QueueBoardTicket, QueueLane } from '#src/contracts/index.ts';
import { pathExists } from '#src/plan/index.ts';
import { isPidAlive, readRunLock } from '#src/runState/index.ts';
import { readShippingProgress } from '#src/ship/index.ts';
import { findNextPlanToPlan, readTicketRecord } from '#src/ticket/index.ts';
import { listRuns } from '#src/views/index.ts';

/**
 * The ship lane's ticket: its shipping block, unless its worktree is gone — the
 * queue removes a shipped worktree before the lane settles the ticket — or its
 * record started before the ticket entered Shipping Now, which makes it an
 * earlier ship's record of the same branch.
 */
const loadShippingBlock = async ({ ticket, worktreePath }: { ticket: QueueBoardTicket; worktreePath: string }) => {
	const { branch } = ticket;
	let lines: string[];

	if (branch === undefined) {
		lines = [`the board recorded no branch for ${ticket.identifier}`];
	} else if (!(await pathExists({ path: worktreePath }))) {
		lines = [`the worktree ${worktreePath} is no longer on disk`];
	} else {
		const { progress } = await readShippingProgress({ cwd: worktreePath, branch });
		const isEarlierShip = progress !== undefined && Date.parse(progress.startedAt) < Date.parse(ticket.enteredAt);

		lines = isEarlierShip
			? [`no ship step of ${branch} has been recorded since ${ticket.identifier} entered Shipping Now`]
			: await loadShippingProgressBlock({ cwd: worktreePath, branch });
	}

	return lines;
};

/**
 * The engine run that stands for a ticket's current build: only runs in its
 * own worktree created since the build began count — anything older belongs to
 * an earlier queue invocation. Of those, the one the worktree's run lock names
 * while its process lives (a phase child during a phase, its coordinator
 * between phases), otherwise the newest.
 */
const findBuildRun = async ({ ticket, worktreePath }: { ticket: QueueBoardTicket; worktreePath: string }) => {
	const since = Date.parse(ticket.buildStartedAt ?? ticket.enteredAt);
	const candidates = (await listRuns({ cwd: worktreePath }))
		.filter((run) => Date.parse(run.createdAt) >= since)
		.sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt));
	const lock = await readRunLock({ cwd: worktreePath });
	const locked = lock !== undefined && isPidAlive({ pid: lock.pid }) ? candidates.find((run) => run.runId === lock.runId) : undefined;

	return locked ?? candidates[0];
};

/**
 * The planning block of the plan an auto-plan session is actually writing.
 *
 * The board records the folder under the plans directory, which for a ticket with
 * a record of its own is the ticket folder rather than a plan: the plan being
 * written is the one inside it still being planned, so the block is read for that
 * plan's address. A folder with no record is a plan folder itself and is read
 * exactly as it always was.
 */
const loadPlanningBlock = async ({ worktreePath, planName }: { worktreePath: string; planName: string }) => {
	const read = await readTicketRecord({ cwd: worktreePath, ticketBranch: planName });

	if ('error' in read) {
		return [read.error];
	}

	const { record } = read;

	if (record === undefined) {
		return loadPlanningProgressBlock({ cwd: worktreePath, name: planName });
	}

	const waiting = findNextPlanToPlan({ record });

	return waiting === undefined
		? [`no plan in ${planName} is waiting to be planned`]
		: loadPlanningProgressBlock({ cwd: worktreePath, name: formatPlanAddress({ ticketBranch: planName, planId: waiting.id }) });
};

/** A building ticket's run block; before any run, an auto-plan ticket's planning block, or a notice for any other ticket. */
const loadBuildBlock = async ({ ticket, worktreePath }: { ticket: QueueBoardTicket; worktreePath: string }) => {
	const run = await findBuildRun({ ticket, worktreePath });
	const { planName } = ticket;
	let lines: string[];

	if (run !== undefined) {
		lines = (await loadRunProgressBlock({ cwd: worktreePath, runId: run.runId })).lines;
	} else if (planName !== undefined) {
		lines = await loadPlanningBlock({ worktreePath, planName });
	} else {
		lines = [`no engine run has started in ${worktreePath} since ${ticket.identifier}'s build began`];
	}

	return lines;
};

interface Params {
	/** A Building ticket, the Shipping Now ticket, or a ticket waiting for a relayed answer. */
	ticket: QueueBoardTicket;
}

/**
 * The lines that stand for one active ticket: exactly what the standalone
 * `status --run`, `--planning` or `--shipping` form prints for its worktree,
 * or a one-line notice when there is nothing honest to show.
 *
 * It never draws a block of its own, and reads nothing outside the ticket's
 * own worktree.
 */
export const loadActiveTicketBlock = async ({ ticket }: Params): Promise<string[]> => {
	const { worktreePath } = ticket;
	let lines: string[];

	if (worktreePath === undefined) {
		lines = [`the board recorded no worktree for ${ticket.identifier}`];
	} else if (ticket.lane === QueueLane.ShippingNow) {
		lines = await loadShippingBlock({ ticket, worktreePath });
	} else {
		lines = await loadBuildBlock({ ticket, worktreePath });
	}

	return lines;
};
