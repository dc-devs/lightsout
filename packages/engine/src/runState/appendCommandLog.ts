import { appendRunLog } from '@/runState/common/utils/appendRunLog';

interface Params {
	cwd: string;
	runId: string;
	record: {
		at: string;
		/** Pipeline step in flight when the command ran. */
		step?: string;
		/** Gate group: a package directory, or 'root'. */
		group: string;
		/** Which gate: generate | check | test | testCoverage | build | format. */
		kind: string;
		command: string;
		/** Absent on skipped records — nothing was executed. */
		exitCode?: number;
		durationMs?: number;
		/** Present only on failure — the tail of combined stdout/stderr. */
		outputTail?: string;
		/** The gate never ran — `reason` says why (e.g. no matching script). */
		skipped?: true;
		reason?: string;
	};
}

/**
 * Append one gate-command execution to the run's `commands.jsonl`. Every
 * command is recorded, passing, failing or skipped — a green gate that
 * leaves no evidence is indistinguishable from a gate that never ran.
 */
export const appendCommandLog = async ({ cwd, runId, record }: Params): Promise<void> => {
	await appendRunLog({ cwd, runId, fileName: 'commands.jsonl', record });
};
