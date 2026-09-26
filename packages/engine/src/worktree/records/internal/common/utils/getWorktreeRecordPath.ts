import { join } from 'node:path';
import { resolveBranchRecordDir } from '#src/common/workspace/resolveBranchRecordDir.ts';

interface Params {
	/** Any checkout of the repository; the primary is resolved from it. */
	cwd: string;
	branch: string;
}

/**
 * A branch's worktree ownership: `worktree.json` in the folder of the work
 * order whose record stores that branch, beside the ship and branch-state
 * records the same branch leaves.
 *
 * Undefined when no work order claims the branch — the branch keeps no local
 * record, rather than one filed under a folder named after it.
 */
export const getWorktreeRecordPath = async ({ cwd, branch }: Params): Promise<string | undefined> => {
	const folder = await resolveBranchRecordDir({ cwd, branch });

	return folder === undefined ? undefined : join(folder, 'worktree.json');
};
