import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveRunDir } from '#src/runState/common/paths/resolveRunDir.ts';

interface Params {
	cwd: string;
	runId: string;
	/** JSONL file within the run dir, e.g. `agents.jsonl`. */
	fileName: string;
	/** One record, serialized as a single JSON line. */
	record: unknown;
}

/**
 * Append one record as a JSON line to a file in the run's directory — the
 * shared primitive behind the run's per-line ledgers (`agents.jsonl`,
 * `commands.jsonl`).
 *
 * The directory is looked up rather than joined, so an append can no longer
 * create a run folder in a location nothing will read back; the `mkdir` stays
 * for the folder the lookup found, so a ledger that is not there yet is still
 * created.
 */
export const appendRunLog = async ({ cwd, runId, fileName, record }: Params): Promise<void> => {
	const dir = await resolveRunDir({ cwd, runId });

	await mkdir(dir, { recursive: true });
	await appendFile(join(dir, fileName), `${JSON.stringify(record)}\n`, 'utf8');
};
