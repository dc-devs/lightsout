/**
 * Where one branch stands, as the queue recorded it.
 *
 * Three values, each written by the one step that makes it true: `Building`
 * when the worktree is created, `Ready` when a clean worker run leaves commits
 * ahead of the default branch, `Merged` when a merge is confirmed. Nothing
 * infers a phase from a worktree directory or from whether a session committed.
 */
export const BranchPhase = {
	Building: 'building',
	Ready: 'ready',
	Merged: 'merged',
} as const;

export type BranchPhase = (typeof BranchPhase)[keyof typeof BranchPhase];
