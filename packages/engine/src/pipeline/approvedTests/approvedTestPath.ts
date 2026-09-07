import { join } from 'node:path';
import { approvedTestsDir } from '#src/pipeline/approvedTests/common/utils/approvedTestsDir.ts';

interface Params {
	cwd: string;
	runId: string;
	/** Repo-relative path of the test-side file. */
	path: string;
}

/**
 * Where the run keeps the approved version of one test-side file:
 * `<repo>/.lightsout/runs/<runId>/approved/<repo-relative path>`.
 *
 * One function, so the approval that takes the copy and the collection that
 * diffs against it can never disagree about where it is.
 */
export const approvedTestPath = ({ cwd, runId, path }: Params): string => {
	return join(approvedTestsDir({ cwd, runId }), path);
};
