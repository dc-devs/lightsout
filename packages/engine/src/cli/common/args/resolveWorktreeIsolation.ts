import { contradictoryWorktreeFlagsMessage } from '#src/cli/common/constants/contradictoryWorktreeFlagsMessage.ts';

interface Params {
	flags: Map<string, string | true>;
	/** The command's own config key — `implement.worktree` or `plan.worktree` — undefined when the config says nothing. */
	configured: boolean | undefined;
}

/**
 * Whether a command works in a worktree of its own: `--worktree` or
 * `--no-worktree` for this one command, then the config key, then on.
 *
 * Decided from the flags and config alone, so a caller can settle isolation
 * before anything touches git — the order `resolveRunWorkspace` and
 * `resolvePlanWorktree` both depend on.
 *
 * @returns true to isolate, false to stay in the launching checkout, or the shared contradiction sentence when both flags were typed
 */
export const resolveWorktreeIsolation = ({ flags, configured }: Params): boolean | { error: string } => {
	const asked = flags.get('worktree') === true;
	const refused = flags.get('no-worktree') === true;

	if (asked && refused) {
		return { error: contradictoryWorktreeFlagsMessage };
	}

	return refused ? false : asked || (configured ?? true);
};
