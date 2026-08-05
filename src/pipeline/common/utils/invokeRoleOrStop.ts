import { RunStatus, type StepRecord, type WorkReport } from '@/contracts';
import type { PipelineResult } from '@/pipeline/PipelineResult';
import type { PipelineRun } from '@/pipeline/PipelineRun';

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
	const { report, failure, rateLimited } = await run.invokeRole({ invocation, step });

	if (rateLimited) {
		return { stopped: await run.stop({ record, status: RunStatus.PausedRateLimit, error: run.parkMessage() }) };
	}

	if (!report) {
		return { stopped: await run.stop({ record, status: RunStatus.Failed, error: failure ?? 'unknown failure' }) };
	}

	return { report };
};
