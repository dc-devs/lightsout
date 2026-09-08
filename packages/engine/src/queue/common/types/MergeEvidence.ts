import type { PullRequestSummary } from '#src/ship/index.ts';

/**
 * Evidence that a branch has merged, and which source established it.
 *
 * Present with no `pullRequest` means this queue's own record answered. Present
 * with one means the forge answered, and `establishBranchMerge` has already
 * written the record.
 */
export interface MergeEvidence {
	/** The merged pull request, present only when the forge is what established the merge. */
	pullRequest?: PullRequestSummary;
}
