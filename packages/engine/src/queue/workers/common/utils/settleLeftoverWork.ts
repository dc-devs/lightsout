import { PlanProgress } from '#src/contracts/index.ts';
import type { WorkOrderPlanStep } from '#src/queue/workers/common/types/WorkOrderPlanStep.ts';
import { commitPlanWork } from '#src/queue/workers/common/utils/commitPlanWork.ts';

interface Params {
	/** The turn of the loop that is about to take a plan. Its `plan` is not what the leftovers are committed under. */
	step: WorkOrderPlanStep;
	/** The source paths already changed in the worktree before the loop built anything. */
	leftover: string[];
}

/**
 * Source work already in the worktree before the loop takes any plan, put under
 * the plan it can only have come from: the most recently implemented one, whose
 * build a refused commit — or a human's `lightsout resume` in this tree — left
 * uncommitted.
 *
 * Leftovers with no implemented plan behind them belong to nobody, so the ticket
 * parks for a human instead of having them committed under a name that would be
 * wrong.
 *
 * @returns the one sentence saying why the loop stopped, or undefined once the tree is settled
 */
export const settleLeftoverWork = async ({ step, leftover }: Params): Promise<string | undefined> => {
	const { cwd, record } = step;

	if (leftover.length === 0) {
		return undefined;
	}

	const owner = record.plans
		.filter((plan) => plan.progress === PlanProgress.Implemented && plan.implementation?.finishedAt !== undefined)
		.sort((first, second) => Date.parse(second.implementation?.finishedAt ?? '') - Date.parse(first.implementation?.finishedAt ?? ''))
		.at(0);

	return owner === undefined
		? `the worktree ${cwd} holds changes no implemented plan of work order ${record.name} accounts for, so the queue cannot say which plan they belong to`
		: commitPlanWork({ step: { ...step, plan: owner } });
};
