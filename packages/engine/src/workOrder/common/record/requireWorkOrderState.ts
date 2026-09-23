import { describeMissingWorkOrder } from '#src/common/utils/describeMissingWorkOrder.ts';
import type { WorkOrderState } from '#src/contracts/index.ts';

interface Params {
	record: WorkOrderState | undefined;
	name: string;
}

/**
 * The record a change is about to be made to, or the one sentence saying why
 * there is no change to make.
 *
 * Two refusals, and every record-changing subcommand owes both. A work order
 * with no record at all is one nobody has started, and the command named is the
 * way to start it. A record carrying `shipped` is history: any change to it
 * could only re-open shipping or misdescribe what shipped, so it is refused
 * whatever the change was. `show` and `sync` never ask here, which is what keeps
 * a merged ticket readable.
 */
export const requireWorkOrderState = ({ record, name }: Params): WorkOrderState | { error: string } => {
	if (record === undefined) {
		return { error: describeMissingWorkOrder({ name }) };
	}

	return record.shipped === undefined
		? record
		: { error: `work order ${record.name} shipped as ${record.shipped.mergeCommit}, and a shipped work order's state is history that no longer changes` };
};
