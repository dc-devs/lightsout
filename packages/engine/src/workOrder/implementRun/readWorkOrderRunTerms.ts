import { basename } from 'node:path';
import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';
import { PlanProgress, WorkOrderMode } from '#src/contracts/index.ts';
import type { WorkOrderRunTerms } from '#src/workOrder/common/types/WorkOrderRunTerms.ts';
import { isWholePlanRun } from '#src/workOrder/common/utils/isWholePlanRun.ts';
import { findPlanImplementationBlocker } from '#src/workOrder/findPlanImplementationBlocker.ts';
import { readWorkOrderShipEligibility } from '#src/workOrder/readWorkOrderShipEligibility.ts';
import { readWorkOrderState } from '#src/workOrder/readWorkOrderState.ts';

interface Params {
	/** Any checkout of the repository; the record is read from its primary checkout. */
	cwd: string;
	/** The run's plan name under the plans directory: a plan address, a legacy folder name, or undefined for a plan outside the plans directory. */
	name: string | undefined;
	/** The run's plan path as the manifest records it (or will): the plan's plan.md, its overview.md, or one phase file. Undefined for a build from the ticket body. */
	planPath: string | undefined;
}

/**
 * What the work order state says about one run of one plan: whether it may start at
 * all, and whether a pass would satisfy the ticket's ship request.
 *
 * `implement` and `resume` ask before their run and `exitAfterImplement` asks
 * after it with the same name, which is what makes the `willShip` stamp on the
 * manifest and the chain that eventually happens agree by construction.
 *
 * A `shipRequest` in the answer means the ticket's own record decides this run's
 * shipping; its absence means `--ship` and `ship.after-implement` decide it, as
 * they always have. Only the LOCAL record is read — no tracker call — because
 * the authoritative check is the ship guard's, which pulls first.
 *
 * @returns the run's refusal and its ship terms, each absent when the ticket has nothing to say
 */
export const readWorkOrderRunTerms = async ({ cwd, name, planPath }: Params): Promise<WorkOrderRunTerms> => {
	// A name that is not a plan address is a legacy folder, or no plan of the plans
	// directory at all: the work order state has nothing to say about either.
	if (name === undefined) {
		return {};
	}

	const address = parsePlanAddress({ name });

	if (address === undefined) {
		return {};
	}

	const read = await readWorkOrderState({ cwd, name: address.workOrderName });

	if ('error' in read) {
		return { refusal: read.error, shipRequest: { blocker: read.error } };
	}

	const { record } = read;

	if (record === undefined) {
		return {};
	}

	const { planId } = address;
	const refusal = findPlanImplementationBlocker({ record, planId });
	let shipRequest: WorkOrderRunTerms['shipRequest'];

	if (planPath !== undefined && !(await isWholePlanRun({ cwd, name, planPath }))) {
		// A run of one phase file never records the plan implemented, so it can never
		// satisfy a ship request either — in any mode.
		shipRequest = {
			blocker: `this run covers ${basename(planPath)} alone, and the implementation of plan ${planId} on work order ${record.branch} has not finished until the whole plan runs`,
		};
	} else if (record.mode === WorkOrderMode.MultiplePlan) {
		// The eligibility rules are never restated here: they are asked of the record
		// as this run's pass would leave it, so the plan this run implements counts as
		// implemented and every other rule still answers for itself.
		const eligibility = readWorkOrderShipEligibility({
			record: { ...record, plans: record.plans.map((plan) => (plan.id === planId ? { ...plan, progress: PlanProgress.Implemented } : plan)) },
		});

		shipRequest = { blocker: eligibility.eligible ? undefined : eligibility.reason };
	}

	return { refusal, shipRequest };
};
