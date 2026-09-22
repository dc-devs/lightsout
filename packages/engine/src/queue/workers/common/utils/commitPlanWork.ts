import { buildRunCommitMessage, commitWorkOrderWork } from '#src/commit/index.ts';
import type { WorkOrderPlanStep } from '#src/queue/workers/common/types/WorkOrderPlanStep.ts';

interface Params {
	step: WorkOrderPlanStep;
}

/**
 * One plan's implementation, committed under a message naming the ticket, the
 * plan id and the plan's title, with the run that built it in the body.
 *
 * The message goes through the shared builder so leftover work this settles
 * carries the same shape as the commit a pipeline makes for itself. A plan with
 * no recorded run id has nothing to put in a body, so it commits under the
 * subject alone.
 *
 * @returns the one sentence saying why nothing was committed, or undefined once it was
 */
export const commitPlanWork = async ({ step }: Params): Promise<string | undefined> => {
	const { cwd, record, plan, ticket, workOrderRunDir, config, onProgress } = step;
	const subject = `${ticket.identifier} ${plan.id}: ${plan.title}`;
	const runId = plan.implementation?.runId;
	const committed = await commitWorkOrderWork({
		cwd,
		message: runId === undefined ? subject : buildRunCommitMessage({ subject, runId }),
		runDir: workOrderRunDir,
		generated: config.generated,
		onProgress,
	});

	return 'error' in committed ? `plan ${plan.id} on ticket ${record.branch} was built, but its work could not be committed: ${committed.error}` : undefined;
};
