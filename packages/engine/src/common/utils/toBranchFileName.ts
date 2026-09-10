interface Params {
	branch: string;
}

/**
 * A branch as a file name: every character outside `A-Za-z0-9._-` becomes `-`.
 *
 * Three records are keyed by branch — the queue's branch state, the ship
 * result, and the worktree's ownership record — and a branch named `feature/x`
 * used as written would write into a `feature` subdirectory rather than one
 * flat file. They key the same branches, so the spelling is shared: a drift
 * between two copies of this expression would file one branch's records under
 * two names.
 */
export const toBranchFileName = ({ branch }: Params): string => {
	return branch.replace(/[^A-Za-z0-9._-]/g, '-');
};
