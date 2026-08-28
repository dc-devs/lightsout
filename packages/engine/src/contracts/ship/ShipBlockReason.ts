/**
 * Why a ship attempt stopped.
 *
 * A typed stop rather than a hidden retry: ship never loops on a red check or
 * a refused merge, so the reason is the whole answer, and re-running
 * `lightsout ship` is the resume path.
 */
export const ShipBlockReason = {
	/** Uncommitted or untracked changes in the working tree. */
	DirtyTree: 'dirty-tree',
	/** The checkout is on the repository's default branch, or the remote's default branch could not be named. */
	DefaultBranch: 'default-branch',
	/** The branch name does not match the configured ticket pattern. */
	TicketPatternMismatch: 'ticket-pattern-mismatch',
	/** `git push --set-upstream origin <branch>` exited non-zero. */
	PushFailed: 'push-failed',
	/** `gh` is missing, or is not authenticated for this repository's host. */
	ForgeNotAuthenticated: 'forge-not-authenticated',
	/** Not inside a git worktree, on a detached HEAD, or git could not answer within its deadline. */
	GitUnreadable: 'git-unreadable',
	/** The forge refused to open or read the pull request. */
	PullRequestUnavailable: 'pull-request-unavailable',
	/** One or more required checks finished red. */
	ChecksFailed: 'checks-failed',
	/** Checks were still running when the wait ceiling was reached. */
	ChecksTimedOut: 'checks-timed-out',
	/** The forge refused the merge (conflict, protected branch, review required). */
	MergeRejected: 'merge-rejected',
} as const;

export type ShipBlockReason = (typeof ShipBlockReason)[keyof typeof ShipBlockReason];
