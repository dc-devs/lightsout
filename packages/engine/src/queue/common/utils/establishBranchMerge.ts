import { BranchPhase } from '#src/contracts/index.ts';
import { readBranchState, writeBranchState } from '#src/queue/branchState/index.ts';
import type { MergeEvidence } from '#src/queue/common/types/MergeEvidence.ts';
import { findPullRequest, PullRequestState } from '#src/ship/index.ts';

interface Params {
	/** The main repository checkout, where every branch-state record lives. */
	cwd: string;
	branch: string;
	onProgress?: (message: string) => void;
}

/**
 * Whether this branch has merged, and which of the two sources said so.
 *
 * A merge is *established* two ways — this queue's own record of having merged
 * the branch, read first so a machine that merged it stays offline, or the
 * forge reporting a merged pull request — and never inferred from a missing
 * branch, an absent open pull request or a clean worktree. An unreadable answer
 * is therefore no answer: absence of evidence never becomes evidence of a
 * merge, so the branch runs its worker.
 *
 * When the forge is what established it, the record is written before the
 * evidence is handed back, so every later run answers the question offline.
 *
 * @returns the evidence, or undefined when neither source established a merge
 */
export const establishBranchMerge = async ({ cwd, branch, onProgress }: Params): Promise<MergeEvidence | undefined> => {
	const recorded = await readBranchState({ cwd, branch });
	let evidence: MergeEvidence | undefined;

	if (recorded?.phase === BranchPhase.Merged) {
		evidence = {};
	} else {
		const pullRequest = await findPullRequest({ branch, cwd, state: PullRequestState.Merged });

		if (pullRequest !== undefined) {
			await writeBranchState({ cwd, branch, phase: BranchPhase.Merged, onProgress });

			evidence = { pullRequest };
		}
	}

	return evidence;
};
