import { formatPlanAddress } from '#src/common/planAddress/formatPlanAddress.ts';
import { planNumberOf } from '#src/common/planAddress/planNumberOf.ts';
import { PlanProgress } from '#src/contracts/workOrder/PlanProgress.ts';
import { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';
import type { WorkOrderPlan } from '#src/contracts/workOrder/WorkOrderPlan.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import { planWorkspacePath } from '#src/plan/planWorkspacePath.ts';

interface Params {
	record: WorkOrderState;
	/** The plan an implementation run is about to be started for. */
	planId: string;
}

/** How to get the plan standing in the way out of the way: finish its own run, or take it out of the order. */
const describeLowerPlanRemedy = ({ name, plan }: { name: string; plan: WorkOrderPlan }) => {
	const finish =
		plan.implementation === undefined
			? `\`lightsout implement --plan ${planWorkspacePath({ name: formatPlanAddress({ workOrderName: name, planId: plan.id }) })}\``
			: `\`lightsout resume --run ${plan.implementation.runId}\``;

	return `${finish}, or take it out of the order with \`lightsout work-order exclude-plan --name ${name} --plan ${plan.id}\``;
};

/** The lowest plan below this one whose implementation has not finished, if there is one — the plans are held in number order. */
const findLowerPlanBlocker = ({ record, planId }: { record: WorkOrderState; planId: string }) => {
	const number = planNumberOf({ id: planId });
	const blocking = record.plans.find(
		(plan) => planNumberOf({ id: plan.id }) < number && plan.exclusion === undefined && plan.progress !== PlanProgress.Implemented,
	);

	return blocking === undefined
		? undefined
		: `plan ${blocking.id} comes before ${planId} on work order ${record.name} and its implementation has not finished, and a work order's plans implement in numeric order — finish it with ${describeLowerPlanRemedy({ name: record.name, plan: blocking })}`;
};

/**
 * Whether one plan of a ticket may have an implementation run started for it,
 * as one sentence naming the plan in the way and the command that resolves it —
 * or undefined when the run may go ahead.
 *
 * Every entry point asks here — `implement`, `resume` and the queue's plan
 * build — so the ticket's numeric order and its mode are enforced on every
 * path rather than only in the queue.
 *
 * The plan's OWN `planning`, `ready`, `implementing` and `failed` progress are
 * never refusals: a standalone run is licensed to build a plan a human points
 * it at whatever its progress says, and resuming a failed or paused run is the
 * repair path this rule exists to keep open.
 *
 * @returns the one sentence saying why the run may not start, or undefined when it may
 */
export const findPlanImplementationBlocker = ({ record, planId }: Params): string | undefined => {
	const { name } = record;
	const plan = record.plans.find((candidate) => candidate.id === planId);
	let blocker: string | undefined;

	if (plan === undefined) {
		blocker = `work order ${name} holds no plan ${planId} — \`lightsout work-order show --name ${name}\` lists the plans it does hold`;
	} else if (plan.exclusion !== undefined) {
		blocker = `plan ${planId} is excluded from work order ${name} — ${plan.exclusion.reason} — and an exclusion is final; add follow-up work as a new plan with \`lightsout work-order add-plan --name ${name}\``;
	} else if (record.mode === WorkOrderMode.SinglePlan && planNumberOf({ id: planId }) !== 1) {
		blocker = `work order ${name} is in single-plan mode, where plan 001 alone supplies the implementation, so plan ${planId} is not built — run \`lightsout work-order mode --name ${name} --set multiple-plan\` to implement this ticket's plans in numeric order`;
	} else if (plan.progress === PlanProgress.Implemented) {
		blocker = `plan ${planId} is already implemented on work order ${name}, and an implemented plan is the scope the ticket ships on; add follow-up work as a new plan with \`lightsout work-order add-plan --name ${name}\``;
	} else {
		blocker = findLowerPlanBlocker({ record, planId });
	}

	return blocker;
};
