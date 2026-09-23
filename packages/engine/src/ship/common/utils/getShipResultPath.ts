import { join } from 'node:path';
import { resolveBranchRecordDir } from '#src/common/workspace/resolveBranchRecordDir.ts';

interface Params {
	/** Any checkout of the repository; the primary is resolved from it. */
	cwd: string;
	/** The branch the result describes, as git names it. */
	branch: string;
}

/**
 * A branch's ship result: `ship.json` in the folder of the work order whose
 * record stores that branch, beside the shipping record the same ship wrote.
 *
 * Undefined when no work order claims the branch. The forge remains ship's
 * durable record of what happened, which is what `findPullRequest` recovers
 * from, so a branch with no local folder loses nothing that cannot be re-read.
 */
export const getShipResultPath = async ({ cwd, branch }: Params): Promise<string | undefined> => {
	const folder = await resolveBranchRecordDir({ cwd, branch });

	return folder === undefined ? undefined : join(folder, 'ship.json');
};
