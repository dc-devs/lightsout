import { join } from 'node:path';
import { resolveRunDir } from '#src/runState/index.ts';

interface Params {
	/** The MAIN repository checkout the coordinator run lives in. */
	cwd: string;
	/** The coordinator run's id. */
	runId: string;
}

/** A queue run's board lives in its coordinator run's own folder: `board.json`, beside its `queue.md`. */
export const getQueueBoardPath = async ({ cwd, runId }: Params): Promise<string> => {
	return join(await resolveRunDir({ cwd, runId }), 'board.json');
};
