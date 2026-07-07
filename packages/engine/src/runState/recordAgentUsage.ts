import type { AgentUsage, RunUsage } from '@lightsout/contracts';
import { appendAgentLog } from './appendAgentLog';

interface Params {
	cwd: string;
	runId: string;
	/** Pipeline step (or batch id) the invocation served. */
	step: string;
	/** Model override in force, if any. */
	model?: string;
	/** The run's mutable usage aggregate — accumulated in place. */
	totals: RunUsage;
	usage?: AgentUsage;
}

/**
 * Record one agent invocation's spend: accumulate into the run's totals and
 * append the per-invocation line to agents.jsonl. Runs spend the user's
 * subscription — every spend leaves a line, in every pipeline, identically.
 */
export const recordAgentUsage = async ({ cwd, runId, step, model, totals, usage }: Params): Promise<void> => {
	if (!usage) {
		return;
	}

	totals.invocations += 1;
	totals.inputTokens += usage.inputTokens;
	totals.outputTokens += usage.outputTokens;
	totals.cacheReadTokens += usage.cacheReadTokens;
	totals.cacheCreationTokens += usage.cacheCreationTokens;
	totals.costUsd += usage.costUsd;

	await appendAgentLog({ cwd, runId, record: { at: new Date().toISOString(), step, model, ...usage } });
};
