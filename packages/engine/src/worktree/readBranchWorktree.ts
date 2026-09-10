import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';

interface Params {
	/** Any checkout of the repository — `git worktree list` answers the same set from all of them. */
	cwd: string;
	branch: string;
}

/**
 * The worktree a branch is currently checked out in, undefined when no worktree
 * holds it, the list is unreadable, the command timed out, or `cwd` is outside
 * a repository.
 *
 * A caller asks this before cutting a tree for a branch: git refuses a second
 * worktree on one branch, and a refusal naming the checkout already holding it
 * is what lets a human choose that checkout on purpose. The porcelain listing
 * is read rather than the directory, because a slash-bearing branch nests
 * directories and an entry name is not a branch name. Same never-throw contract
 * as every reader in `common/git`.
 */
export const readBranchWorktree = async ({ cwd, branch }: Params): Promise<string | undefined> => {
	const listed = await runCommand({ command: 'git worktree list --porcelain', cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);
	let found: string | undefined;

	for (const block of (listed?.exitCode === 0 ? listed.stdout : '').split('\n\n')) {
		const path = /^worktree (.+)$/m.exec(block)?.[1];

		if (path !== undefined && /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] === branch) {
			found = path;
			break;
		}
	}

	return found;
};
