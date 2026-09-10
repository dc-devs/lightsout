import { readGitPrimaryCheckout } from '#src/common/git/readGitPrimaryCheckout.ts';
import { type RunManifest, WorktreeOwner } from '#src/contracts/index.ts';
import { deleteWorktreeRecord, readWorktreeRecord, removeWorktree } from '#src/worktree/index.ts';

interface Params {
	/** The checkout the ship just ran in — the run's workspace when it was isolated. */
	cwd: string;
	/** The run that shipped; its recorded workspace and branch are what decide whether a tree comes down. */
	manifest: RunManifest;
	onProgress?: (message: string) => void;
}

/**
 * The tree this shipped run may take down, or undefined when nothing licenses a
 * removal.
 *
 * The ownership record is the only licence — not a flag and not a per-run
 * boolean, because a resumed run did not create the tree its first invocation
 * created, and the record is what makes that fact outlive the process that
 * established it. That is also what keeps a checkout the user selected with
 * `--no-worktree` and a queue-owned tree out of reach: neither carries an
 * `Implement` record. A record naming some other path never licenses removing
 * this workspace, so a reused branch name cannot take down the wrong tree.
 *
 * The primary checkout is resolved here rather than taken from the caller, so
 * the answer is the same whether the ship tail handed over the launching
 * checkout or the workspace itself.
 */
const describeRemovableTree = async ({ cwd, manifest }: { cwd: string; manifest: RunManifest }) => {
	const { workspace, branch } = manifest;

	if (workspace === undefined || branch === undefined) {
		return undefined;
	}

	const primary = (await readGitPrimaryCheckout({ cwd })) ?? cwd;
	const record = await readWorktreeRecord({ cwd: primary, branch });
	const owned = record?.owner === WorktreeOwner.Implement && record.worktreePath === workspace;

	return owned ? { cwd: primary, branch, worktreePath: workspace } : undefined;
};

/**
 * Take down the worktree a standalone implementation run built in, once its
 * branch has merged.
 *
 * Best effort throughout and never throwing, for the reason `shipOneBranch`
 * gives: the merge has already happened by the time this runs, and a failed
 * cleanup must not turn a shipped run into a failed one. The tree comes down
 * before the record is deleted, and the record only when the removal worked — a
 * record deleted beside a tree that survived is exactly the unclaimed tree a
 * later drain adopts.
 *
 * The run's own records are never touched: they live in the checkout the
 * command was launched from, which is the whole reason they are written there.
 */
export const removeShippedRunWorkspace = async ({ cwd, manifest, onProgress }: Params): Promise<void> => {
	const removable = await describeRemovableTree({ cwd, manifest });

	if (removable === undefined) {
		return;
	}

	const failure = await removeWorktree(removable);

	if (failure === undefined) {
		onProgress?.(`removed the worktree at ${removable.worktreePath}`);
		await deleteWorktreeRecord({ cwd: removable.cwd, branch: removable.branch });
	} else {
		onProgress?.(failure.error);
	}
};
