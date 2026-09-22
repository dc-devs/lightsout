import { formatPlanAddress } from '#src/common/planAddress/formatPlanAddress.ts';
import { planNumberOf } from '#src/common/planAddress/planNumberOf.ts';
import { PlanProgress, WorkOrderMode } from '#src/contracts/index.ts';
import { readWorkOrderState } from '#src/workOrder/index.ts';

interface Params {
	/** The checkout the build happens in, whose primary checkout holds the ticket record. */
	cwd: string;
	/** The branch the build happens on, which names the ticket folder. Undefined when git could not name one. */
	branch: string | undefined;
}

/**
 * The plan a build from this branch's ticket body is the implementation of, as a
 * plan's `--name` — or undefined when nothing on the record claims it.
 *
 * Only single-plan plan 001 ever does. Single-plan mode means plan 001 alone
 * supplies the ticket's implementation however it is built, so a body build IS
 * that plan's implementation and the ship guard has to see it recorded. A
 * multiple-plan ticket builds every plan from its own plan deliverable, so a body
 * build is none of its plans' work and touches nothing.
 *
 * @returns the plan address, the record's read error, or undefined when no plan claims the build
 */
export const readBodyBuildPlanName = async ({ cwd, branch }: Params): Promise<string | { error: string } | undefined> => {
	if (branch === undefined) {
		return undefined;
	}

	const read = await readWorkOrderState({ cwd, name: branch });

	if ('error' in read) {
		return { error: read.error };
	}

	const record = read.record;

	if (record === undefined || record.mode !== WorkOrderMode.SinglePlan) {
		return undefined;
	}

	const first = record.plans.find((plan) => planNumberOf({ id: plan.id }) === 1 && plan.exclusion === undefined && plan.progress !== PlanProgress.Implemented);

	return first === undefined ? undefined : formatPlanAddress({ ticketBranch: branch, planId: first.id });
};
