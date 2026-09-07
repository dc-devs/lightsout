import { join } from 'node:path';
import { getRunDir } from '#src/runState/index.ts';

interface Params {
	cwd: string;
	runId: string;
}

/**
 * The run's approved-copy root: `<repo>/.lightsout/runs/<runId>/approved`.
 *
 * One function, so the path builder and the cleanup can never disagree about
 * which directory holds the baseline.
 */
export const approvedTestsDir = ({ cwd, runId }: Params): string => {
	return join(getRunDir({ cwd, runId }), 'approved');
};
