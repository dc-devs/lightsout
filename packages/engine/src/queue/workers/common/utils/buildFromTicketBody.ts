import { formatPlanAddress } from '#src/common/planAddress/formatPlanAddress.ts';
import { runDirectWork } from '#src/direct/index.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import type { WorkOrderPlanStep } from '#src/queue/workers/common/types/WorkOrderPlanStep.ts';
import { runWorkOrderPlanLifecycle, type WorkOrderPlanOutcome } from '#src/workOrder/index.ts';

interface Params {
	step: WorkOrderPlanStep;
}

/** The wrapped run read back in the queue's three terms, exactly as a plan-folder build states one. */
const toBuildOutcome = ({ outcome }: { outcome: WorkOrderPlanOutcome }) => {
	if ('refusal' in outcome) {
		return { error: outcome.refusal };
	}

	const { result, recordError } = outcome;

	if (result.ok) {
		return recordError === undefined ? {} : { error: recordError };
	}

	const stated = result.error ?? `the run ended ${result.manifest.status}`;

	return { error: `${stated} — \`lightsout resume --run ${result.manifest.runId}\` continues it from the worktree` };
};

/**
 * The one build with no plan deliverable behind it: plan 001 of a single-plan
 * ticket whose brainstorm judged it ready to implement from the ticket body
 * alone.
 *
 * It still goes through the ticket lifecycle helper, because plan 001 supplies a
 * single-plan work order's whole implementation however it was built — and a plan the
 * record does not show as implemented is a plan the ship check refuses.
 *
 * It never relays a question, for the reason a plan-folder build does not: the
 * run it wraps has no answer channel, so an escalated run parks with its worktree
 * intact instead.
 */
export const buildFromTicketBody = async ({ step }: Params): Promise<WorkerOutcome> => {
	const { cwd, record, plan, ticket, config, driver, driverName, onProgress } = step;

	onProgress?.(`${ticket.identifier} carries no plan deliverable for plan ${plan.id}, so it is built from the ticket body`);

	return toBuildOutcome({
		outcome: await runWorkOrderPlanLifecycle({
			cwd,
			name: formatPlanAddress({ workOrderName: record.name, planId: plan.id }),
			run: ({ runId }) => runDirectWork({ cwd, ticketBody: ticket.description, ticketRef: ticket.identifier, runId, driver, driverName, config, onProgress }),
		}),
	});
};
