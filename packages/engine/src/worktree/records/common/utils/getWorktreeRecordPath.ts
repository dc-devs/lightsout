import { join } from 'node:path';
import { toBranchFileName } from '#src/common/utils/toBranchFileName.ts';
import { ticketFolderDir } from '#src/common/workspace/ticketFolderDir.ts';

interface Params {
	/** Any checkout of the repository; the primary is resolved from it. */
	cwd: string;
	branch: string;
}

/**
 * A branch's worktree ownership: `worktree.json` in that branch's ticket
 * folder, beside the ship and branch-state records the same branch leaves.
 *
 * It takes a `cwd` rather than an already-resolved state directory because
 * `ticketFolderDir` resolves the primary checkout itself — which is what keeps
 * "the record lives in the primary checkout" true by construction rather than
 * by every caller remembering.
 *
 * The branch is slugged rather than used as written, so a branch carrying a
 * slash names one flat ticket folder rather than a nested one.
 */
export const getWorktreeRecordPath = async ({ cwd, branch }: Params): Promise<string> => {
	return join(await ticketFolderDir({ cwd, ticketBranch: toBranchFileName({ branch }) }), 'worktree.json');
};
