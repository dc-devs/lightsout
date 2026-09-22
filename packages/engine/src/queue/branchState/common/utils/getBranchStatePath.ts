import { join } from 'node:path';
import { toBranchFileName } from '#src/common/utils/toBranchFileName.ts';
import { workOrderFolderDir } from '#src/common/workspace/workOrderFolderDir.ts';

interface Params {
	/** Any checkout of the repository; the primary is resolved from it. */
	cwd: string;
	branch: string;
}

/**
 * A branch's queue phase: `branch-state.json` in that branch's ticket folder,
 * beside the ship and worktree records the same branch leaves.
 *
 * The branch is slugged rather than used as written, because the queue's branch
 * template is free to carry slashes, and one used as written would make a
 * nested directory rather than that branch's own folder.
 */
export const getBranchStatePath = async ({ cwd, branch }: Params): Promise<string> => {
	return join(await workOrderFolderDir({ cwd, name: toBranchFileName({ branch }) }), 'branch-state.json');
};
