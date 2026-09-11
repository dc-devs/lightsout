import { join } from 'node:path';
import { getRunDir } from '#src/runState/index.ts';

interface Params {
	/** The MAIN repository checkout the coordinator run lives in. */
	cwd: string;
	/** The coordinator run's id. */
	runId: string;
}

/** A queue run's board lives in its coordinator run's own folder: `<repo>/.lightsout/runs/<runId>/board.json`, beside its `queue.md`. */
export const getQueueBoardPath = ({ cwd, runId }: Params): string => {
	return join(getRunDir({ cwd, runId }), 'board.json');
};
