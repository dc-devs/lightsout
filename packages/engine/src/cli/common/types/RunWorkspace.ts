/**
 * The resolved answer to "which checkout does this run work in?".
 *
 * `created` and `isolated` genuinely differ: a run continuing in the tree a
 * planning session established is `isolated: true, created: false`, while a
 * run that cut its own tree is `isolated: true, created: true`. Removal is
 * still gated on the worktree ownership record, never on this type — the run
 * that continues in a planning tree re-stamps that record to `implement`, which
 * is what licenses the post-ship cleanup.
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
