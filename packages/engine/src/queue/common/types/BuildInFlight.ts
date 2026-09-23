import type { NamedWorkOrder } from '#src/queue/common/types/NamedWorkOrder.ts';

/** One build the drain has started and not yet settled. */
export interface BuildInFlight {
	workOrder: NamedWorkOrder;
	/** ISO time the builder picked the work order up. */
	startedAt: string;
}
