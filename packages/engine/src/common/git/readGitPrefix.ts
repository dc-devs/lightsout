import { runCommand } from '../utils/runCommand';

const gitTimeoutMs = 60_000;

interface Params {
	cwd: string;
}

/**
 * The consumer root's path inside its git repo (`git rev-parse --show-prefix`):
 * '' when the consumer IS the repo root, 'fixtures/toy-calc/' style when it is
 * nested, undefined outside any worktree. Nested consumers are where the two
 * changed-file truths can diverge — git paths need the prefix stripped, and
 * agents sometimes echo repo-root-relative paths in their reports.
 */
export const readGitPrefix = async ({ cwd }: Params) => {
	const prefix = await runCommand({ command: 'git rev-parse --show-prefix', cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);

	return prefix && prefix.exitCode === 0 ? prefix.stdout.trim() : undefined;
};
