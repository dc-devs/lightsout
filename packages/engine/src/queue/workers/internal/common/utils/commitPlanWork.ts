import { commitWorkOrderWork } from '#src/commit/commitWorkOrderWork.ts';
import { composeCommitMessage } from '#src/commit/composeCommitMessage.ts';
import type { WorkOrderPlanStep } from '#src/queue/workers/internal/common/types/WorkOrderPlanStep.ts';

interface Params {
	step: WorkOrderPlanStep;
}

/**
 * One plan's implementation, committed under a subject naming the ticket and
 * the agent's summary of the staged change, with the plan and the run that
 * built it in the body.
 *
 * The message goes through the shared composer so leftover work this settles
 * carries the same shape as the commit a pipeline makes for itself. When the
 * agent cannot answer, the plan-address subject — the ticket, the plan id and
 * the plan's title — stands in. Nothing is billed: the queue has no run ledger
 * of its own to write the call to.
 *
 * @returns the one sentence saying why nothing was committed, or undefined once it was
 */
export const commitPlanWork = async ({ step }: Params): Promise<string | undefined> => {
	const { cwd, record, plan, ticket, workOrderRunDir, config, driver, onProgress } = step;
	const address = {
		reference: ticket.identifier,
		fallbackSubject: `${ticket.identifier} ${plan.id}: ${plan.title}`,
		context: `Plan ${plan.id}: ${plan.title}`,
		unit: plan.id,
	};
	const committed = await commitWorkOrderWork({
		cwd,
		composeMessage: ({ cwd: worktree }) => composeCommitMessage({ cwd: worktree, driver, config, address, runId: plan.implementation?.runId, onProgress }),
		runDir: workOrderRunDir,
		generated: config.generated,
		onProgress,
	});

	return 'error' in committed ? `plan ${plan.id} on work order ${record.name} was built, but its work could not be committed: ${committed.error}` : undefined;
};
