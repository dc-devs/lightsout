import { join } from 'node:path';
import { toBranchFileName } from '#src/common/utils/toBranchFileName.ts';
import { ticketFolderDir } from '#src/common/workspace/ticketFolderDir.ts';

interface Params {
	/** Any checkout of the repository; the primary is resolved from it. */
	cwd: string;
	/** The branch as git names it. */
	branch: string;
}

/**
 * A branch's shipping record: `ship-progress.json` in that branch's ticket
 * folder, beside the ship result the same ship files there.
 *
 * The branch is slugged the same way the result's is, so a branch template
 * carrying a slash names one flat ticket folder rather than a nested one.
 */
export const getShippingProgressPath = async ({ cwd, branch }: Params): Promise<string> => {
	return join(await ticketFolderDir({ cwd, ticketBranch: toBranchFileName({ branch }) }), 'ship-progress.json');
};
