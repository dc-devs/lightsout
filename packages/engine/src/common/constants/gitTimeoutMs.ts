/**
 * How long any `git` probe the engine runs may take before it is killed.
 *
 * Git reads are the engine's second source of changed-file truth, and both
 * helpers that perform one owe the same deadline: a repo slow enough to blow
 * it fails the read, and a run that granted different budgets per command
 * would report "not a worktree" for one probe and a timeout for the next.
 */
export const gitTimeoutMs = 60_000;
