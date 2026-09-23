/** One worktree git knows about: where it is, which branch it holds, and the work order whose record claims that branch. */
export interface ParkedTree {
	/** The queue's own spelling of the path, already re-rooted by the scan. */
	path: string;
	branch: string;
	/** The tracker ticket the work order belongs to, read from its record rather than out of the branch name. */
	identifier: string;
	/** The work order's label — its folder under the work-orders directory. */
	name: string;
}
