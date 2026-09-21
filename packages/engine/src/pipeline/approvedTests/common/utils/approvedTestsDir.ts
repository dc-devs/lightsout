import { join } from 'node:path';
import { resolveRunDir } from '#src/runState/index.ts';

interface Params {
	cwd: string;
	runId: string;
}

/**
 * The run's approved-copy root: the `approved` folder in the run's own folder.
 *
 * One function, so the path builder and the cleanup can never disagree about
 * which directory holds the baseline.
 */
export const approvedTestsDir = async ({ cwd, runId }: Params): Promise<string> => {
	return join(await resolveRunDir({ cwd, runId }), 'approved');
};
