import { dirname } from 'node:path';
import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';

interface Params {
	cwd: string;
}

/**
 * The primary checkout of the repository `cwd` belongs to — the directory
 * holding the real `.git` — undefined outside any repository and on a timeout.
 *
 * In a primary checkout this is `cwd` itself. In a linked worktree it is the
 * checkout the worktree was added from, which is where a gitignored file such
 * as `.env` lives, because a worktree is a fresh checkout and never carries one.
 * `git rev-parse --git-common-dir` is git's own answer to "where is the shared
 * `.git`", asked with an absolute path so the caller never has to know which
 * directory git resolved it against. Same deadline and same never-throw
 * contract as its neighbours.
 */
export const readGitPrimaryCheckout = async ({ cwd }: Params): Promise<string | undefined> => {
	const common = await runCommand({ command: 'git rev-parse --path-format=absolute --git-common-dir', cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);
	const gitDir = common && common.exitCode === 0 ? common.stdout.trim() : '';

	return gitDir === '' ? undefined : dirname(gitDir);
};
