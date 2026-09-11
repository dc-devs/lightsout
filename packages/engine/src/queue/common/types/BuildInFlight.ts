import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';

/** One build the drain has started and not yet settled. */
export interface BuildInFlight {
	ticket: RunnableTicket;
	/** ISO time the builder picked the ticket up. */
	startedAt: string;
}
