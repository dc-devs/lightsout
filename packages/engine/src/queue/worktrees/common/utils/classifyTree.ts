import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { BranchPhase } from '#src/contracts/index.ts';
import { readBranchState } from '#src/queue/branchState/index.ts';
import { ParkedTreeBucket } from '#src/queue/worktrees/common/constants/ParkedTreeBucket.ts';
import type { ParkedTree } from '#src/queue/worktrees/common/types/ParkedTree.ts';
import { classifyUnrecordedTree } from '#src/queue/worktrees/common/utils/classifyUnrecordedTree.ts';

interface Params {
	/** The main repository checkout, where every branch-state record lives. */
	cwd: string;
	tree: ParkedTree;
	defaultBranch: string;
	onProgress?: (message: string) => void;
}

/**
 * Where one parked worktree goes next, read from the branch's own record rather
 * than guessed from the directory.
 *
 * The merge question is asked before this helper runs, so a merged branch never
 * reaches it and `settled` is not an answer it can give. A dirty tree wins over
 * the record: sending uncommitted work to the merge would merge none of it, and
 * the drain still ends the branch merged in the same run, because the ticket's
 * own run commits what is there and records `ready` again. Only with no record
 * at all does git decide, and the answer is written down.
 */
export const classifyTree = async ({ cwd, tree, defaultBranch, onProgress }: Params): Promise<ParkedTreeBucket> => {
	const changed = await readGitChangedFiles({ cwd: tree.path });

	if (changed === undefined) {
		return ParkedTreeBucket.Unreadable;
	}

	if (changed.length > 0) {
		return ParkedTreeBucket.Drain;
	}

	const recorded = await readBranchState({ cwd, branch: tree.branch });

	if (recorded !== undefined) {
		return recorded.phase === BranchPhase.Ready ? ParkedTreeBucket.Ship : ParkedTreeBucket.Drain;
	}

	return classifyUnrecordedTree({ cwd, tree, defaultBranch, onProgress });
};
