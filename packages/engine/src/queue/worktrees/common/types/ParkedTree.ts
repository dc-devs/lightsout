/** One worktree git knows about: where it is, which branch it holds, and the ticket its branch names. */
export interface ParkedTree {
	/** The queue's own spelling of the path, already re-rooted by the scan. */
	path: string;
	branch: string;
	identifier: string;
}
