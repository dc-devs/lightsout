import { QueueBoardState } from '#src/cli/internal/common/constants/QueueBoardState.ts';
import { loadActiveTicketBlock } from '#src/cli/internal/common/queueBoard/loadActiveTicketBlock.ts';
import { renderQueueBoard } from '#src/cli/internal/common/queueBoard/renderQueueBoard.ts';
import { renderTicketDetailBlock } from '#src/cli/internal/common/queueBoard/renderTicketDetailBlock.ts';
import { resolveQueueRun } from '#src/cli/internal/common/queueBoard/resolveQueueRun.ts';
import type { QueueBoardTicket } from '#src/contracts/queue/QueueBoardTicket.ts';
import { QueueLane } from '#src/contracts/queue/QueueLane.ts';
import { PipelineKind } from '#src/contracts/run/PipelineKind.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { RunListing } from '#src/contracts/views/RunListing.ts';
import { getQueueBoardPath } from '#src/queue/board/getQueueBoardPath.ts';
import { readQueueBoard } from '#src/queue/board/readQueueBoard.ts';

/** Live while a going manifest has a live process behind it, stopped when it has none, finished otherwise. */
const toBoardState = ({ listing }: { listing: RunListing }) => {
	const going = listing.status === RunStatus.Running || listing.status === RunStatus.Pending;
	let state: QueueBoardState = QueueBoardState.Finished;

	if (going) {
		state = listing.live ? QueueBoardState.Live : QueueBoardState.Stopped;
	}

	return state;
};

/** A ticket someone is working right now: building, shipping, or a live worker waiting for a relayed answer. */
const isActive = ({ ticket }: { ticket: QueueBoardTicket }) =>
	ticket.lane === QueueLane.Building || ticket.lane === QueueLane.ShippingNow || (ticket.lane === QueueLane.Blocked && ticket.question !== undefined);

/**
 * The board, then — only while the queue is live — one detail block per
 * active ticket, in column order and, inside a column, in record order.
 */
const printBoard = async ({ cwd, listing }: { cwd: string; listing: RunListing }) => {
	const board = await readQueueBoard({ cwd, runId: listing.runId });

	if (board === undefined) {
		console.log(`the queue run has no readable board yet: ${await getQueueBoardPath({ cwd, runId: listing.runId })}`);
		return;
	}

	const state = toBoardState({ listing });
	// A live board is drawn now; a stopped or finished one shows when it was last written.
	const at = state === QueueBoardState.Live ? new Date() : new Date(board.updatedAt);
	const active =
		state === QueueBoardState.Live
			? Object.values(QueueLane).flatMap((lane) => board.tickets.filter((ticket) => ticket.lane === lane && isActive({ ticket })))
			: [];
	const lines = renderQueueBoard({ tickets: board.tickets, state, at });

	for (const ticket of active) {
		lines.push(...renderTicketDetailBlock({ ticket, lines: await loadActiveTicketBlock({ ticket }) }));
	}

	for (const line of lines) {
		console.log(line);
	}
};

interface Params {
	/** The main checkout the queue runs in. */
	cwd: string;
	/** The queue run to show, already resolved on disk; without it, the live queue run the checkout's run lock names. */
	runId?: string;
	/** Wait up to a minute for a queue run to take the lock — for a caller that has only just launched one. */
	wait?: boolean;
}

/**
 * `status --queue`: the queue's board, then one fenced status block per active
 * ticket — the whole update the queue skill posts, printed once and appended
 * with `console.log`, never clearing the screen.
 *
 * No queue run going, or a queue run with no board yet, is a normal answer. A
 * named run that is not a queue run, or whose manifest does not read, is the
 * reader's mistake, said on stderr.
 *
 * @returns the exit code the command ends with: 0 for every answer but a named run that cannot be shown, which is 1
 */
export const printQueueStatus = async ({ cwd, runId, wait }: Params): Promise<number> => {
	const listing = await resolveQueueRun({ cwd, runId, wait });
	let code = 0;

	if (listing === undefined && runId !== undefined) {
		console.error(`run ${runId} could not be read`);
		code = 1;
	} else if (listing === undefined) {
		console.log(`no queue run is going in ${cwd}`);
	} else if (listing.pipeline !== PipelineKind.Queue) {
		console.error(`run ${listing.runId} is not a queue run — it is a ${listing.pipeline} run`);
		code = 1;
	} else {
		await printBoard({ cwd, listing });
	}

	return code;
};
