import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentUsage } from '@lightsout/contracts';
import { getRunDir } from './getRunDir';

interface Params {
	cwd: string;
	runId: string;
	record: AgentUsage & {
		at: string;
		/** Pipeline step the invocation served (supervisor consultations suffixed `-supervisor`). */
		step: string;
		/** Model override in force, if any — harness default otherwise. */
		model?: string;
	};
}

/**
 * Append one agent invocation's usage to the run's `agents.jsonl` — the
 * per-invocation cost ledger beside `commands.jsonl`. Runs spend the user's
 * subscription; every spend leaves a line.
 */
export const appendAgentLog = async ({ cwd, runId, record }: Params) => {
	const dir = getRunDir({ cwd, runId });

	await mkdir(dir, { recursive: true });
	await appendFile(join(dir, 'agents.jsonl'), `${JSON.stringify(record)}\n`, 'utf8');
};
