import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';

/** One wave entry after its name is settled: the tracker ticket, the work order's label, and the branch its record stores. */
export interface NamedWorkOrder {
	/** The tracker ticket this work order was created for. */
	ticket: RunnableTicket;
	/** The work order's label — its folder under the work-orders directory, and the first segment of every plan address it holds. */
	name: string;
	/** The git branch the record says this work order's plans implement on. Equal to `name` under the default template, and not under a prefixed one. */
	branch: string;
}
