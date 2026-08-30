import { join } from 'node:path';
import { getRunDir } from '#src/runState/common/paths/getRunDir.ts';

interface Params {
	cwd: string;
	runId: string;
}

/** A run's persisted narration, one JSON line per progress message. */
export const getProgressLogPath = ({ cwd, runId }: Params): string => {
	return join(getRunDir({ cwd, runId }), 'progress.jsonl');
};
