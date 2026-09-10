import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';
import { runOrDescribeFailure } from '#src/common/processes/runOrDescribeFailure.ts';
import type { WorktreeFailure } from '#src/worktree/common/types/WorktreeFailure.ts';

interface Params {
	/** The checkout holding the worktree list. */
	cwd: string;
	worktreePath: string;
	branch: string;
}

/**
 * The local cleanup after a branch has merged: drop its worktree, prune the
 * list, and delete the branch.
 *
 * Every step is best effort and nothing throws, for the same reason
 * `syncDefaultBranch` gives: the merge has already happened by the time this
 * runs, and a failed cleanup must not turn a shipped branch into a failed one.
 * The removal step's own refusal is answered rather than swallowed, so the
 * caller can tell a tree that came down from one that is still standing. The
 * prune and the branch delete stay silent: a branch git will not delete because
 * it does not consider it merged is an ordinary outcome, not a failed removal.
 *
 * `git branch -d` rather than `-D`, so a branch git does not consider merged
 * survives.
 *
 * The ownership record is deliberately untouched. Deleting it belongs to the
 * caller, after a removal that worked — a record deleted beside a tree that
 * survived is exactly the unclaimed tree a later drain adopts, which the record
 * exists to prevent.
 *
 * @returns the sentence git refused the removal with, or undefined when the tree came down
 */
export const removeWorktree = async ({ cwd, worktreePath, branch }: Params): Promise<WorktreeFailure | undefined> => {
	const removal = await runOrDescribeFailure({ command: `git worktree remove --force ${worktreePath}`, cwd });

	for (const command of ['git worktree prune', `git branch -d ${branch}`]) {
		await runCommand({ command, cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);
	}

	return removal === undefined ? undefined : { error: `git could not remove the worktree at ${worktreePath}: ${removal}` };
};
