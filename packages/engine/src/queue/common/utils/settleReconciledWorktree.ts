import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { deleteWorktreeRecord, removeWorktree } from '#src/worktree/index.ts';

interface Params {
	/** The main repository checkout. */
	cwd: string;
	/** The worktree as the caller already spells it, never re-derived here. */
	worktreePath: string;
	branch: string;
	onProgress?: (message: string) => void;
}

/**
 * The worktree a reconciled ticket leaves behind, settled: removed when the
 * tree is clean, kept when it is not.
 *
 * A reconciled ticket never reaches the ship step, which is the only other code
 * that removes a worktree — so leaving a clean one would make every later drain
 * rediscover work that already shipped. A dirty one is never removed: a merged
 * pull request says nothing about work begun in that directory since.
 *
 * The ownership record is deleted only after a removal that worked. A record
 * dropped beside a tree still standing is the unclaimed tree a later drain
 * adopts, so a kept tree and a failed removal both keep theirs.
 *
 * @returns the sentence to append to the skip reason, or undefined when there was nothing to keep
 */
export const settleReconciledWorktree = async ({ cwd, worktreePath, branch, onProgress }: Params): Promise<string | undefined> => {
	const changed = await readGitChangedFiles({ cwd: worktreePath });

	if (changed === undefined) {
		return undefined;
	}

	if (changed.length > 0) {
		onProgress?.(`the worktree at ${worktreePath} has uncommitted changes, so it was left in place`);

		return ` — the worktree at ${worktreePath} was left in place because it has uncommitted changes`;
	}

	const removal = await removeWorktree({ cwd, worktreePath, branch });

	if (removal === undefined) {
		await deleteWorktreeRecord({ cwd, branch });
	}

	return undefined;
};
