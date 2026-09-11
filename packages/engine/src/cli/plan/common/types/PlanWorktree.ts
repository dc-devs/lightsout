/**
 * The resolved answer to "which checkout does this planning session act on?".
 *
 * Mirrors `RunWorkspace` field for field, and is a separate type because
 * `RunWorkspace` is the shape a run manifest's recorded workspace is read back
 * through. Not named `PlanWorkspace`: that phrase already means the plan's
 * folder, not a checkout.
 */
export interface PlanWorktree {
	/** Absolute path of the checkout every plan subcommand acts on. */
	cwd: string;
	/** The branch the tree stands on — the plan's own name. Absent when isolation is off. */
	branch?: string;
	/** True when planning works in a worktree rather than the launching checkout. */
	isolated: boolean;
	/** True when THIS invocation cut the tree. */
	created: boolean;
}
