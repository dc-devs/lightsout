import { join } from 'node:path';
import { resolveBranchRecordDir } from '#src/common/workspace/resolveBranchRecordDir.ts';

interface Params {
	/** Any checkout of the repository; the primary is resolved from it. */
	cwd: string;
	branch: string;
}

/**
 * A branch's queue phase: `branch-state.json` in the folder of the work order
 * whose record stores that branch, beside the ship and worktree records the
 * same branch leaves and the plans it implements.
 *
 * Undefined when no work order claims the branch: nothing derives a folder from
 * a branch any more, so a branch nobody authored keeps no local record at all.
 */
export const getBranchStatePath = async ({ cwd, branch }: Params): Promise<string | undefined> => {
	const folder = await resolveBranchRecordDir({ cwd, branch });

	return folder === undefined ? undefined : join(folder, 'branch-state.json');
};
