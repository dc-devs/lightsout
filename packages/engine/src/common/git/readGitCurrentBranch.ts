import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';

interface Params {
	cwd: string;
}

/**
 * The branch the checkout is on (`git rev-parse --abbrev-ref HEAD`), undefined
 * outside a worktree, on a detached HEAD, and on a timeout.
 *
 * A detached HEAD answers the literal word `HEAD`, which is not a branch
 * anything can be pushed to — so it is reported as absence rather than passed
 * on as a name. Held to the same deadline and the same never-throw contract as
 * its neighbours: absence is a value, exactly as in `readGitPrefix`.
 */
export const readGitCurrentBranch = async ({ cwd }: Params): Promise<string | undefined> => {
	const branch = await runCommand({ command: 'git rev-parse --abbrev-ref HEAD', cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);
	const name = branch && branch.exitCode === 0 ? branch.stdout.trim() : '';

	return name === '' || name === 'HEAD' ? undefined : name;
};
