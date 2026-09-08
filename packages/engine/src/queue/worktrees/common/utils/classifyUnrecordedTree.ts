import { readGitCommitsAhead } from '#src/common/git/readGitCommitsAhead.ts';
import { BranchPhase } from '#src/contracts/index.ts';
import { writeBranchState } from '#src/queue/branchState/index.ts';
import { ParkedTreeBucket } from '#src/queue/worktrees/common/constants/ParkedTreeBucket.ts';
import type { ParkedTree } from '#src/queue/worktrees/common/types/ParkedTree.ts';

interface Params {
	/** The main repository checkout, where every branch-state record lives. */
	cwd: string;
	tree: ParkedTree;
	defaultBranch: string;
	onProgress?: (message: string) => void;
}

/**
 * The bucket for a tree nothing has recorded yet, and the record written from
 * it — today's git count, made durable so no later scan has to run it again.
 *
 * The write is narrower than the bucket on purpose: a count git could not give
 * is not a fact worth recording. Records are never deleted and a recorded phase
 * short-circuits the count above, so persisting `building` for an answer git
 * never gave would send a branch that already carries finished commits back to
 * a worker on every future scan, with the count that would have found it never
 * running again.
 */
export const classifyUnrecordedTree = async ({
	cwd,
	tree,
	defaultBranch,
	onProgress,
}: Params): Promise<typeof ParkedTreeBucket.Drain | typeof ParkedTreeBucket.Ship> => {
	const ahead = await readGitCommitsAhead({ cwd: tree.path, defaultBranch });

	if (ahead === undefined) {
		return ParkedTreeBucket.Drain;
	}

	const carriesCommits = ahead > 0;

	await writeBranchState({ cwd, branch: tree.branch, phase: carriesCommits ? BranchPhase.Ready : BranchPhase.Building, onProgress });

	return carriesCommits ? ParkedTreeBucket.Ship : ParkedTreeBucket.Drain;
};
