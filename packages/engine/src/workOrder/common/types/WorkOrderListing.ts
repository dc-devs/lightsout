import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';

/**
 * One entry of the work-orders directory: the folder's label and the record it
 * holds.
 *
 * A plain interface rather than a schema, because nothing parses a listing off
 * a wire — each `record` was already parsed by the module's own reader.
 */
export interface WorkOrderListing {
	/** The folder's own name under the work-orders directory. */
	name: string;
	record: WorkOrderState;
}
