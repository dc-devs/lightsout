import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getRunDir } from '#src/runState/common/paths/getRunDir.ts';

interface Params {
	cwd: string;
	runId: string;
	/** JSONL file within the run dir, e.g. `agents.jsonl`. */
	fileName: string;
	/** One record, serialized as a single JSON line. */
	record: unknown;
}

/**
 * Append one record as a JSON line to a file in the run's directory, creating
 * the directory if needed — the shared primitive behind the run's per-line
 * ledgers (`agents.jsonl`, `commands.jsonl`).
 */
export const appendRunLog = async ({ cwd, runId, fileName, record }: Params): Promise<void> => {
	const dir = getRunDir({ cwd, runId });

	await mkdir(dir, { recursive: true });
	await appendFile(join(dir, fileName), `${JSON.stringify(record)}\n`, 'utf8');
};
