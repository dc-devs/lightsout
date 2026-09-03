/** The pull-request states the forge readers ask `gh` for, spelled as `gh pr list --state` takes them. */
export const PullRequestState = {
	/** Not merged and not closed — ship's resume path adopts one of these. */
	Open: 'open',
	/** Merged into the default branch — the queue's positive evidence that a ticket already shipped. */
	Merged: 'merged',
} as const;

export type PullRequestState = (typeof PullRequestState)[keyof typeof PullRequestState];
