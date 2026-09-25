import { PlanProgress } from '#src/contracts/workOrder/PlanProgress.ts';
import type { WorkOrderPlan } from '#src/contracts/workOrder/WorkOrderPlan.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';

interface Params {
	record: WorkOrderState;
	/** The plan the ordered build is about to take. */
	plan: WorkOrderPlan;
}

/**
 * Why the queue will not build past a plan whose own implementation was started
 * and did not finish — failed, or still recorded as being implemented, which is
 * what a paused or interrupted run leaves.
 *
 * That is a failure a human repairs rather than something to wait on, so the
 * ticket parks: the queue never retries a failed plan and never resumes a paused
 * run. The sentence names both repair paths the ticket has.
 *
 * @returns the one sentence saying why the loop stopped, or undefined when the plan may be built
 */
export const findStalledPlanRefusal = ({ record, plan }: Params): string | undefined => {
	if (plan.progress !== PlanProgress.Failed && plan.progress !== PlanProgress.Implementing) {
		return undefined;
	}

	const finish = plan.implementation === undefined ? '' : `finish it with \`lightsout resume --run ${plan.implementation.runId}\`, or `;

	return `the implementation of plan ${plan.id} on work order ${record.name} has not finished, and a work order's plans implement in numeric order — ${finish}take it out of the order with \`lightsout work-order exclude-plan --name ${record.name} --plan ${plan.id}\``;
};
