import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getRunDir } from './getRunDir';

interface Params {
	cwd: string;
	runId: string;
	record: {
		at: string;
		/** Pipeline step in flight when the command ran. */
		step?: string;
		/** Gate group: a package directory, or 'root'. */
		group: string;
		/** Which gate: check | testUnit | testCoverage | build | format. */
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
export const appendCommandLog = async ({ cwd, runId, record }: Params) => {
	const dir = getRunDir({ cwd, runId });

	await mkdir(dir, { recursive: true });
	await appendFile(join(dir, 'commands.jsonl'), `${JSON.stringify(record)}\n`, 'utf8');
};
