import { formatPlanAddress } from '#src/common/planAddress/formatPlanAddress.ts';
import type { WorkOrderPlan } from '#src/contracts/workOrder/WorkOrderPlan.ts';
import { runDirectWork } from '#src/direct/runDirectWork.ts';
import type { WorkerOutcome } from '#src/queue/internal/common/types/WorkerOutcome.ts';
import type { WorkOrderPlanStep } from '#src/queue/workers/internal/common/types/WorkOrderPlanStep.ts';
import { toWorkerOutcome } from '#src/queue/workers/internal/common/utils/toWorkerOutcome.ts';
import type { WorkOrderPlanOutcome } from '#src/workOrder/common/types/WorkOrderPlanOutcome.ts';
import { runWorkOrderBodyBuildLifecycle } from '#src/workOrder/implementRun/runWorkOrderBodyBuildLifecycle.ts';
import { runWorkOrderPlanLifecycle } from '#src/workOrder/implementRun/runWorkOrderPlanLifecycle.ts';

interface Params {
	/** `plan` is absent for a single-plan work order holding no plan 001, whose build is recorded on the record itself. */
	step: Omit<WorkOrderPlanStep, 'plan'> & { plan?: WorkOrderPlan };
}

/**
 * The builds with no plan deliverable behind them: plan 001 of a single-plan
 * ticket whose brainstorm judged it ready to implement from the ticket body
 * alone, and a single-plan work order that holds no plan 001 at all.
 *
 * Both go through a work order lifecycle helper, because the ship check reads
 * the record: plan 001 supplies a single-plan work order's whole implementation
 * however it was built, and a work order holding no plan 001 is implemented by
 * the build from the ticket body recorded on the record itself. A build the
 * record does not show as passed is one the ship check refuses.
 *
 * It never relays a question, for the reason a plan-folder build does not: the
 * run it wraps has no answer channel, so an escalated run parks with its worktree
 * intact instead.
 */
export const buildFromTicketBody = async ({ step }: Params): Promise<WorkerOutcome> => {
	const { cwd, record, plan, ticket, config, driver, driverName, onProgress } = step;
	const run = ({ runId }: { runId: string }) =>
		runDirectWork({ cwd, ticketBody: ticket.description, ticketRef: ticket.identifier, runId, driver, driverName, config, onProgress });
	let outcome: WorkOrderPlanOutcome;

	if (plan === undefined) {
		onProgress?.(`${ticket.identifier} holds no plan on work order ${record.name}, so it is built from the ticket body`);
		outcome = await runWorkOrderBodyBuildLifecycle({ cwd, workOrderName: record.name, run });
	} else {
		onProgress?.(`${ticket.identifier} carries no plan deliverable for plan ${plan.id}, so it is built from the ticket body`);
		outcome = await runWorkOrderPlanLifecycle({ cwd, name: formatPlanAddress({ workOrderName: record.name, planId: plan.id }), run });
	}

	// A failed plan-less build never names `lightsout resume`: a resumed run
	// records nothing on a record with no plan 001, so it could never make the
	// ticket shippable, and the queue rebuilds it on the next pickup instead.
	return toWorkerOutcome({
		outcome,
		onFailedRun: ({ stated, result }) => ({
			error:
				plan === undefined
					? `${stated} — the queue builds ${ticket.identifier} from the ticket body again the next time it picks the ticket up`
					: `${stated} — \`lightsout resume --run ${result.manifest.runId}\` continues it from the worktree`,
		}),
	});
};
