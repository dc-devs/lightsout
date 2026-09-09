/**
 * Why a ship attempt stopped.
 *
 * A typed stop, reached only once ship's own bounded recovery is spent: the
 * sequence integrates, repairs and re-attempts within one invocation, and the
 * reason it finally records is the whole answer. Re-running `lightsout ship`
 * is still the resume path.
 */
export const ShipBlockReason = {
	/** Uncommitted or untracked changes in the working tree. */
	DirtyTree: 'dirty-tree',
	/** The checkout is on the repository's default branch, or the remote's default branch could not be named. */
	DefaultBranch: 'default-branch',
	/** The branch name does not match the configured ticket pattern. */
	TicketPatternMismatch: 'ticket-pattern-mismatch',
	/** The configured `pre-ship` command exited non-zero, or its changes could not be committed. */
	PreShipFailed: 'pre-ship-failed',
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
	/** Git could not fetch `origin`, could not start the merge, or could not say what commit the branch was on. */
	IntegrationUnavailable: 'integration-unavailable',
	/** Merging the remote default branch left conflicts that the bounded recovery did not settle. */
	IntegrationConflict: 'integration-conflict',
	/** The integrated branch did not pass the repository's own gates within the repair allowance. */
	IntegrationGatesFailed: 'integration-gates-failed',
	/** No CI checks appeared for the pushed commit before the wait ceiling, and the repository has not explicitly opted out. */
	ChecksMissing: 'checks-missing',
} as const;

export type ShipBlockReason = (typeof ShipBlockReason)[keyof typeof ShipBlockReason];
