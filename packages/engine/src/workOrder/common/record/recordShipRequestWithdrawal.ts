import { WorkOrderEventKind, type WorkOrderState } from '#src/contracts/index.ts';
import { appendWorkOrderEvent } from '#src/workOrder/common/record/appendWorkOrderEvent.ts';

interface Params {
	record: WorkOrderState;
	/** Why the request no longer describes the ticket's work — the sentence the history keeps. */
	detail: string;
	at: string;
}

/**
 * The record with any pending ship request taken off it, and the withdrawal
 * recorded.
 *
 * A record carrying no request comes back untouched, so every caller calls this
 * unconditionally rather than each deciding for itself whether there was one to
 * withdraw. The request that was made stays readable beside its withdrawal,
 * which is the whole point of recording one rather than replacing the field.
 */
export const recordShipRequestWithdrawal = ({ record, detail, at }: Params): WorkOrderState =>
	record.shipRequest === undefined
		? record
		: appendWorkOrderEvent({ record: { ...record, shipRequest: undefined }, kind: WorkOrderEventKind.ShipRequestWithdrawn, detail, at });
