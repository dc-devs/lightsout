import { planNumberOf } from '#src/common/planAddress/planNumberOf.ts';
import { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';
import type { WorkOrderPlan } from '#src/contracts/workOrder/WorkOrderPlan.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import { isPlanImplementationStarted } from '#src/workOrder/internal/common/record/isPlanImplementationStarted.ts';

interface Params {
	record: WorkOrderState;
	/** The plan the exclusion is about. */
	target: WorkOrderPlan;
	/** The human's declaration that this plan's implementation is off the branch. */
	implementationRemoved: boolean;
}

/**
 * Every refusal decidable from the record alone, checked before a gate run
 * starts and again inside the change, because the record can move while those
 * gates run. An exclusion is final, and the one amendment it takes is a
 * verified removal recorded on top of one that had none — the way back to
 * single-plan mode once a human has taken a later plan's code off the branch.
 */
export const findExclusionRefusal = ({ record, target, implementationRemoved }: Params): string | undefined => {
	const started = isPlanImplementationStarted({ plan: target });

	if (record.mode === WorkOrderMode.SinglePlan && planNumberOf({ id: target.id }) === 1) {
		return `plan ${target.id} is the whole implementation of single-plan work order ${record.name}, so excluding it would leave the ticket nothing to ship — run \`lightsout work-order mode --name ${record.name} --set multiple-plan\` first if this ticket's work has moved on`;
	}

	if (implementationRemoved && !started) {
		return `plan ${target.id} on work order ${record.name} has no implementation to remove, because its own implementation never started — exclude it without --implementation-removed`;
	}

	return target.exclusion !== undefined && !(implementationRemoved && started && !target.exclusion.implementationRemoved)
		? `plan ${target.id} is already excluded from work order ${record.name} — ${target.exclusion.reason} — and an exclusion is final; the one thing a recorded exclusion still takes is \`--implementation-removed\`, once that plan's implementation has been taken off the branch`
		: undefined;
};
