import { z } from 'zod';
import { QueueBoardTicket } from '#src/contracts/queue/QueueBoardTicket.ts';

/**
 * Every ticket a queue run is working and the lane each one is in, written to
 * `board.json` in the coordinator run's folder in the MAIN checkout.
 *
 * The queue is its only writer. It rewrites the record in full, through a
 * temporary file and a rename, so a reader never sees half a board.
 */
export const QueueBoard = z.object({
	coordinatorRunId: z.string(),
	/** ISO time the snapshot this record holds was taken. */
	updatedAt: z.string(),
	/** Lane by lane in column order; inside one lane, in the drain's ledger order. */
	tickets: z.array(QueueBoardTicket),
});

export type QueueBoard = z.infer<typeof QueueBoard>;
