import { RunStatus, type StepRecord, type WorkReport } from '#src/contracts/index.ts';
import type { PipelineResult } from '#src/pipeline/PipelineResult.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

interface Params {
	run: PipelineRun;
	/** The step record used to persist a park/failure stop. */
	record: StepRecord;
	invocation: { systemPrompt: string; prompt: string };
	step: string;
}

/**
 * Invoke a working role and enforce the two terminal outcomes every step
 * shares: park on a rate limit, fail on an absent report. Returns the agent's
 * report to continue with, or the stop result the caller returns immediately.
 */
export const invokeRoleOrStop = async ({ run, record, invocation, step }: Params): Promise<{ report: WorkReport } | { stopped: PipelineResult }> => {
	const outcome = await run.invokeRole({ invocation, step });

	if (!outcome.ok) {
		return outcome.rateLimited
			? { stopped: await run.stop({ record, status: RunStatus.PausedRateLimit, error: run.parkMessage() }) }
			: { stopped: await run.stop({ record, status: RunStatus.Failed, error: outcome.failure }) };
	}

	return { report: outcome.report };
};
