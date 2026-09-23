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
	 * Set only for an auto-plan ticket: the work order's label, which is the
	 * folder under the work-orders directory the worker's session writes in.
	 *
	 * The label rather than the branch, because a plan address is built from the
	 * label and a branch carrying a prefix would not parse as one. The plan the
	 * session is writing is the one inside that folder still being planned.
	 */
	planName: z.string().optional(),
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
