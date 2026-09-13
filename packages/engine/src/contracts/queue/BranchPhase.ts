/**
 * Where one branch stands, as the queue recorded it.
 *
 * Four values, each written by the one step that makes it true: `Building`
 * when the worktree is created, `Ready` when a clean worker run leaves commits
 * ahead of the default branch, `Open` when a multiple-plan ticket's worker
 * built everything it could and the ticket's record does not authorize shipping
 * it — also written when the ship step's own ticket check refuses a branch
 * already recorded ready — and `Merged` when a merge is confirmed. Nothing
 * infers a phase from a worktree directory or from whether a session committed.
 */
export const BranchPhase = {
	Building: 'building',
	Ready: 'ready',
	Open: 'open',
	Merged: 'merged',
} as const;

export type BranchPhase = (typeof BranchPhase)[keyof typeof BranchPhase];
