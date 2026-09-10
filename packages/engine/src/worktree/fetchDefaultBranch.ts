import { readGitDefaultBranch } from '#src/common/git/readGitDefaultBranch.ts';
import { runOrDescribeFailure } from '#src/common/processes/runOrDescribeFailure.ts';
import type { WorktreeFailure } from '#src/worktree/common/types/WorktreeFailure.ts';

interface Params {
	cwd: string;
}

/**
 * The remote's default branch, with the remote brought up to date first — what
 * a new worktree's branch is cut from.
 *
 * The fetch comes first because a clone whose `origin/HEAD` was never set can
 * be repaired by one, so reading the head before fetching would refuse a
 * repository the very next step would have fixed. A fetch that failed stops the
 * run rather than answering from a stale remote: a branch cut from yesterday's
 * default is a branch the ship step then has to rebase.
 *
 * @returns the branch name without the `origin/` prefix, or the sentence naming what to do next
 */
export const fetchDefaultBranch = async ({ cwd }: Params): Promise<string | WorktreeFailure> => {
	// The fetch crosses the network, so it takes a deadline of its own rather
	// than the git ceiling, which is sized for local reads.
	const fetchTimeoutMs = 60_000;
	const fetchFailure = await runOrDescribeFailure({ command: 'git fetch origin', cwd, timeoutMs: fetchTimeoutMs });

	if (fetchFailure !== undefined) {
		return { error: `git could not fetch origin: ${fetchFailure}` };
	}

	const defaultBranch = await readGitDefaultBranch({ cwd });
	const unset = "the remote's default branch is unset, so there is nothing to cut a branch from — set it with `git remote set-head origin --auto`";

	return defaultBranch ?? { error: unset };
};
