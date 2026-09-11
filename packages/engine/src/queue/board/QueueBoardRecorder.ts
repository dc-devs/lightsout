import { mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';
import type { QueueBoard, QueueLane } from '#src/contracts/index.ts';
import type { QueueBoardLanes } from '#src/queue/board/common/types/QueueBoardLanes.ts';
import { getQueueBoardPath } from '#src/queue/board/getQueueBoardPath.ts';
import { toQueueBoardTickets } from '#src/queue/board/toQueueBoardTickets.ts';
import type { QueueDrainReport } from '#src/queue/common/types/QueueDrainReport.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { resolveWorktreesRoot } from '#src/worktree/index.ts';

interface ConstructorParams {
	/** The MAIN repository checkout the coordinator run lives in. */
	cwd: string;
	/** The coordinator run's id — the board's folder and its `coordinatorRunId`. */
	runId: string;
	/** `QueueSettings.branchTemplate`, to name the branch of a ticket that has no outcome yet. */
	branchTemplate: string;
	onProgress?: (message: string) => void;
}

interface Snapshot {
	settled: QueueDrainReport;
	lanes: QueueBoardLanes;
}

/** Copies of the lists the drain goes on mutating, so a recorded snapshot never changes after the call. */
const copySnapshot = ({ settled, lanes }: Snapshot) => ({
	settled: { outcomes: [...settled.outcomes], leftBehind: [...settled.leftBehind] },
	lanes: {
		pending: [...lanes.pending],
		building: [...lanes.building],
		readyToShip: [...lanes.readyToShip],
		shipping: lanes.shipping,
		blocked: [...lanes.blocked],
	},
});

/**
 * The one writer of a queue run's board.
 *
 * A class because it holds state across calls: the drain's last snapshot, the
 * questions workers are waiting on, when each ticket entered its lane, and the
 * chain that writes one file at a time. Recording never waits and never throws,
 * so a slow or failed write cannot stop, delay or reorder the drain; a failed
 * write is one progress line.
 */
export class QueueBoardRecorder {
	private readonly cwd: string;
	private readonly runId: string;
	private readonly branchTemplate: string;
	private readonly onProgress?: (message: string) => void;
	private readonly questions = new Map<string, string>();
	private entered = new Map<string, { lane: QueueLane; at: string }>();
	private last: Snapshot | undefined;
	private worktreesRoot: string | undefined;
	// Each write awaits its predecessor, so an older snapshot never lands over a newer one.
	private chain: Promise<void> = Promise.resolve();

	constructor({ cwd, runId, branchTemplate, onProgress }: ConstructorParams) {
		this.cwd = cwd;
		this.runId = runId;
		this.branchTemplate = branchTemplate;
		this.onProgress = onProgress;
	}

	/** Rewrite the board from the drain's ledger as it stands now. */
	record({ settled, lanes }: { settled: QueueDrainReport; lanes: QueueBoardLanes }): void {
		this.last = copySnapshot({ settled, lanes });
		this.enqueue();
	}

	/** A worker has asked a relayed question: its ticket moves to Blocked with the question until the ask settles. */
	markWaiting({ ticket, question }: { ticket: TicketSummary; question: string }): void {
		this.questions.set(ticket.identifier.toLowerCase(), question);
		this.enqueue();
	}

	/** The worker's relayed question has settled, answered or not. */
	clearWaiting({ ticket }: { ticket: TicketSummary }): void {
		this.questions.delete(ticket.identifier.toLowerCase());
		this.enqueue();
	}

	/** Resolves once every write asked for so far has landed or failed. Never rejects. */
	flush(): Promise<void> {
		return this.chain;
	}

	/** Queue a write of the last snapshot with the questions open now — nothing until the drain has recorded one. */
	private enqueue() {
		if (this.last === undefined) {
			return;
		}

		const pending = { snapshot: this.last, questions: new Map(this.questions), takenAt: new Date().toISOString() };

		this.chain = this.chain.then(() => this.write(pending)).catch(() => undefined);
	}

	private async write({
		snapshot,
		questions,
		takenAt,
	}: {
		snapshot: Snapshot;
		questions: ReadonlyMap<string, string>;
		/** ISO time the write was asked for — the board's `updatedAt`. */
		takenAt: string;
	}) {
		const path = getQueueBoardPath({ cwd: this.cwd, runId: this.runId });

		try {
			this.worktreesRoot ??= await resolveWorktreesRoot({ cwd: this.cwd });

			const tickets = toQueueBoardTickets({
				settled: snapshot.settled,
				live: { ...snapshot.lanes, questions, entered: this.entered, branchTemplate: this.branchTemplate, worktreesRoot: this.worktreesRoot },
				at: takenAt,
			});
			const board: QueueBoard = { coordinatorRunId: this.runId, updatedAt: takenAt, tickets };

			this.entered = new Map(tickets.map((ticket) => [ticket.identifier.toLowerCase(), { lane: ticket.lane, at: ticket.enteredAt }]));
			await mkdir(dirname(path), { recursive: true });
			await writeJsonFile({ path: `${path}.tmp`, value: board });
			await rename(`${path}.tmp`, path);
		} catch (error) {
			this.onProgress?.(`the queue board ${path} could not be written: ${messageOf({ error })}`);
		}
	}
}
