import type { WorkOrderState } from '#src/contracts/index.ts';

/**
 * What a record-changing ticket operation answers with when it succeeded.
 *
 * Three parts, because a change can succeed and still have something to say:
 * the record as it now stands, one sentence the command prints before its own
 * lines, and the publish that did not happen. A `publishError` is never a
 * failure — the change HAS happened on this machine, and a caller told
 * otherwise would be invited to make it twice.
 */
export interface TicketRecordChange {
	record: WorkOrderState;
	/** One sentence the command prints first — why a ship request was withdrawn, what a mode switch changed about shipping, what to publish next. */
	notice?: string;
	/** Set when the local change was written but publishing it failed; `lightsout work-order sync` retries. */
	publishError?: string;
}
