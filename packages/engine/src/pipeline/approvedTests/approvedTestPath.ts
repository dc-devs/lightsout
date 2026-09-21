import { join } from 'node:path';
import { approvedTestsDir } from '#src/pipeline/approvedTests/common/utils/approvedTestsDir.ts';

interface Params {
	cwd: string;
	runId: string;
	/** Repo-relative path of the test-side file. */
	path: string;
}

/**
 * Where the run keeps the approved version of one test-side file: its
 * repo-relative path under the run's `approved` folder.
 *
 * One function, so the approval that takes the copy and the collection that
 * diffs against it can never disagree about where it is.
 */
export const approvedTestPath = async ({ cwd, runId, path }: Params): Promise<string> => {
	return join(await approvedTestsDir({ cwd, runId }), path);
};
