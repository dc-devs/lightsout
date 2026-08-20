import type { AgentUsage, Effort } from '#src/contracts/index.ts';
import { appendRunLog } from '#src/runState/common/utils/appendRunLog.ts';

interface Params {
	cwd: string;
	runId: string;
	record: AgentUsage & {
		at: string;
		/** Pipeline step the invocation served (supervisor consultations suffixed `-supervisor`). */
		step: string;
		/** Model override in force, if any — harness default otherwise. */
		model?: string;
		/** Resolved effort in force, if any — harness default otherwise. */
		effort?: Effort;
	};
}

/**
 * Append one agent invocation's usage to the run's `agents.jsonl` — the
 * per-invocation cost ledger beside `commands.jsonl`. Runs spend the user's
 * subscription; every spend leaves a line.
 */
export const appendAgentLog = async ({ cwd, runId, record }: Params): Promise<void> => {
	await appendRunLog({ cwd, runId, fileName: 'agents.jsonl', record });
};
