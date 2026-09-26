import { join } from 'node:path';
import { resolveBranchRecordDir } from '#src/common/workspace/resolveBranchRecordDir.ts';

interface Params {
	/** Any checkout of the repository; the primary is resolved from it. */
	cwd: string;
	/** The branch as git names it. */
	branch: string;
}

/**
 * A branch's shipping record: `ship-progress.json` in the folder of the work
 * order whose record stores that branch, beside the ship result the same ship
 * files there.
 *
 * Undefined when no work order claims the branch, exactly as the result's path
 * is: the record is filed with the work order's plans or it is not filed at all.
 */
export const getShippingProgressPath = async ({ cwd, branch }: Params): Promise<string | undefined> => {
	const folder = await resolveBranchRecordDir({ cwd, branch });

	return folder === undefined ? undefined : join(folder, 'ship-progress.json');
};
