import type { WorkOrderEventKind } from '#src/contracts/workOrder/WorkOrderEventKind.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';

interface Params {
	record: WorkOrderState;
	kind: WorkOrderEventKind;
	detail: string;
	/** ISO timestamp of the moment the event happened. */
	at: string;
}

/**
 * The one way this module writes a ticket's history: a new record whose events
 * end with this one.
 *
 * The input is never mutated, and nothing here can drop or rewrite an earlier
 * event — which is what makes the store's append-only rule something the
 * operations satisfy by construction rather than by care.
 */
export const appendWorkOrderEvent = ({ record, kind, detail, at }: Params): WorkOrderState => ({
	...record,
	history: [...record.history, { at, kind, detail }],
});
