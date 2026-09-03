import type { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';

/**
 * A summary the queue has decided to run: its `worker` is settled, not
 * optional.
 *
 * It carries the invariant the selection steps establish, so no step downstream
 * reads an optional field with a ternary that would silently mean the direct
 * worker for a ticket nothing selected.
 */
export interface RunnableTicket extends TicketSummary {
	worker: QueueWorker;
}
