import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';

interface Params {
	/** The worktree whose HEAD is counted. */
	cwd: string;
	defaultBranch: string;
}

/**
 * How many commits `HEAD` carries ahead of `origin/<defaultBranch>`, or
 * undefined when git could not answer.
 *
 * Undefined is never folded into zero: "this branch has no commits" and "git
 * could not be read" send a worktree to different places, and the caller is the
 * one that knows which.
 */
export const readGitCommitsAhead = async ({ cwd, defaultBranch }: Params): Promise<number | undefined> => {
	const counted = await runCommand({ command: `git rev-list --count origin/${defaultBranch}..HEAD`, cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);

	if (counted?.exitCode !== 0) {
		return undefined;
	}

	const commits = Number.parseInt(counted.stdout.trim(), 10);

	return Number.isFinite(commits) ? commits : undefined;
};
