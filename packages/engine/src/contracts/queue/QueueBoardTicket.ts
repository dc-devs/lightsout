import { z } from 'zod';
import { QueueLane } from '#src/contracts/queue/QueueLane.ts';

/** One ticket's place on the queue's board: the one lane it is in, and what a reader needs to find its work. */
export const QueueBoardTicket = z.object({
	identifier: z.string(),
	title: z.string().optional(),
	url: z.string().optional(),
	lane: z.enum(QueueLane),
	/** The queue worker value that builds the ticket. */
	worker: z.string().optional(),
	/**
	 * The work order's label — its folder under the work-orders directory —
	 * recorded for every ticket the board places from a work order, whatever
	 * worker builds it.
	 *
	 * The label rather than the branch, because a plan address and a runs folder
	 * are both named by the label, and a branch carrying a template prefix names
	 * neither. Absent on an entry the queue left behind before a work order
	 * existed, and on a board written by an engine older than this field.
	 */
	workOrderName: z.string().optional(),
	branch: z.string().optional(),
	worktreePath: z.string().optional(),
	/** ISO time the ticket entered its current lane. */
	enteredAt: z.string(),
	/** ISO time its current build began. Set on a Building ticket and on a live question wait. */
	buildStartedAt: z.string().optional(),
	/** Why a ticket is Parked or Blocked, or a Shipped ticket's reconciliation failure. */
	reason: z.string().optional(),
	/** Set only while the ticket's live worker waits for a relayed answer. */
	question: z.string().optional(),
});

export type QueueBoardTicket = z.infer<typeof QueueBoardTicket>;
