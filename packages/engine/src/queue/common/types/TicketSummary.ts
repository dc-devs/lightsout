import type { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import type { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { TrackerTicket } from '#src/ticketTracker/index.ts';

/**
 * One ticket the queue is working, which is a tracker ticket plus what its
 * planning-status label resolved to and the worker that label and its status
 * together select.
 *
 * The seam builds the `TrackerTicket`; `toPlanningSummaries` is the one place a
 * label becomes a planning status.
 */
export interface TicketSummary extends TrackerTicket {
	/** Which planning-status label this ticket carried. */
	planningStatus: PlanningStatus;
	/** The worker the pair selected, absent when the pair is not one the queue takes. */
	worker?: QueueWorker;
}
