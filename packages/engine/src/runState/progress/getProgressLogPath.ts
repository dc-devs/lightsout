import { join } from 'node:path';
import { resolveRunDir } from '#src/runState/common/paths/resolveRunDir.ts';

interface Params {
	cwd: string;
	runId: string;
}

/** A run's persisted narration, one JSON line per progress message. */
export const getProgressLogPath = async ({ cwd, runId }: Params): Promise<string> => {
	return join(await resolveRunDir({ cwd, runId }), 'progress.jsonl');
};
