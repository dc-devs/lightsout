import type { Effort } from '#src/contracts/Effort.ts';
import type { AgentUsage } from '#src/contracts/run/AgentUsage.ts';
import type { RunUsage } from '#src/contracts/run/RunUsage.ts';
import { appendAgentLog } from '#src/runState/internal/common/utils/appendAgentLog.ts';

interface Params {
	cwd: string;
	runId: string;
	/** Pipeline step (or batch id) the invocation served. */
	step: string;
	/** Model override in force, if any. */
	model?: string;
	/** Resolved effort in force — the harness default when absent. */
	effort?: Effort;
	/** The run's mutable usage aggregate — accumulated in place. */
	totals: RunUsage;
	usage?: AgentUsage;
}

/**
 * Record one agent invocation's spend: accumulate into the run's totals and
 * append the per-invocation line to agents.jsonl. Runs spend the user's
 * subscription — every spend leaves a line, in every pipeline, identically.
 */
export const recordAgentUsage = async ({ cwd, runId, step, model, effort, totals, usage }: Params): Promise<void> => {
	if (!usage) {
		return;
	}

	totals.invocations += 1;
	totals.inputTokens += usage.inputTokens;
	totals.outputTokens += usage.outputTokens;
	totals.cacheReadTokens += usage.cacheReadTokens;
	totals.cacheCreationTokens += usage.cacheCreationTokens;
	totals.costUsd += usage.costUsd;

	await appendAgentLog({ cwd, runId, record: { at: new Date().toISOString(), step, model, effort, ...usage } });
};
