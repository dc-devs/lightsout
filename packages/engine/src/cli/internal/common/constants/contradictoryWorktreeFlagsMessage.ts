/**
 * What both implement commands say when `--worktree` and `--no-worktree` are
 * typed together.
 *
 * One shared sentence for the same reason `contradictoryShipFlagsMessage` is
 * one: a user who hits it from `implement` must not be told something else by
 * `implement-direct`.
 */
export const contradictoryWorktreeFlagsMessage = '--worktree and --no-worktree contradict each other — pass at most one';
