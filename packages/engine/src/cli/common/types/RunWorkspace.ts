/**
 * The resolved answer to "which checkout does this run work in?".
 *
 * `created` and `isolated` cannot disagree while `createWorktree` is called
 * with `reuseExisting: false` — a leftover directory is refused rather than
 * adopted, so an isolated run always made its own tree. Both are still
 * recorded, because they answer different questions and only one of them
 * survives a change to that flag; removal itself is gated on the worktree
 * ownership record, never on this type alone.
 */
export interface RunWorkspace {
	/** Absolute path of the checkout every step after resolution acts on. */
	cwd: string;
	/** The branch the workspace was put on. Absent when isolation is off, where the run builds whatever branch the checkout already holds. */
	branch?: string;
	/** True when the run works in a worktree rather than the launching checkout. */
	isolated: boolean;
	/** True when THIS run created the worktree. Read together with the worktree ownership record when a later confirmed merge decides whether the tree may be removed. */
	created: boolean;
}
