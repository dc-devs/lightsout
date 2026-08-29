import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';

interface Params {
	/** The main repository checkout — where the worktree list lives. */
	cwd: string;
	worktreePath: string;
	branch: string;
}

/**
 * The local cleanup after a ticket has merged: drop its worktree, prune the
 * list, and delete the branch.
 *
 * Every step is best effort and nothing throws, for the same reason
 * `syncDefaultBranch` gives: the merge has already happened by the time this
 * runs, and a failed cleanup must not turn a shipped ticket into a failed one.
 *
 * `git branch -d` rather than `-D`, so a branch git does not consider merged
 * survives.
 */
export const removeTicketWorktree = async ({ cwd, worktreePath, branch }: Params): Promise<void> => {
	const steps = [`git worktree remove --force ${worktreePath}`, 'git worktree prune', `git branch -d ${branch}`];

	for (const command of steps) {
		await runCommand({ command, cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);
	}
};
