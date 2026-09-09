/** What git did when it was asked to bring the remote default branch into the checked-out branch. */
export interface MergeOutcome {
	/** Exact freshly fetched default commit, absent only when fetch/ref inspection fails. */
	baseCommit?: string;
	/** Repo-relative paths git left unmerged. Empty when the merge applied cleanly or was never needed. */
	conflictPaths: string[];
	/** Whether the merge brought commits the branch had not been verified against. False when `origin/<default-branch>` was already an ancestor of `HEAD`. */
	integrated: boolean;
	/** Why git could not fetch or could not finish the merge for a reason that is not a textual conflict. Undefined when git answered. */
	failure: string | undefined;
}
