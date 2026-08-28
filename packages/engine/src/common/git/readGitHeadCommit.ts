import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';

interface Params {
	cwd: string;
}

/**
 * The commit `HEAD` is at (`git rev-parse HEAD`), undefined outside a worktree,
 * on a repo with no commits, and on a timeout.
 *
 * It is what lets a saved verdict say which code it was measured against: a
 * timestamp alone cannot tell a grade taken weeks ago from a fresh one. Held to
 * the same deadline and the same never-throw contract as its two neighbours —
 * absence is a value, exactly as in `readGitPrefix`.
 */
export const readGitHeadCommit = async ({ cwd }: Params): Promise<string | undefined> => {
	const head = await runCommand({ command: 'git rev-parse HEAD', cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);

	return head && head.exitCode === 0 ? head.stdout.trim() : undefined;
};
