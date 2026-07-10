import { readGitPrefix } from './readGitPrefix';
import { runCommand } from '../utils/runCommand';

const gitTimeoutMs = 60_000;

interface Params {
	cwd: string;
	/** Ref to diff against (--base <ref>). */
	base: string;
}

/**
 * Files changed since `base` (`git diff --name-only <base>`), repo paths
 * stripped to cwd-relative like readGitChangedFiles. Includes deletions
 * (they legitimately widen package scope) and tracked working-tree edits;
 * untracked files come from the dirty-tree union in runVerify.
 *
 * @throws {Error} When cwd is not inside a git worktree or `base` is not a resolvable ref.
 */
export const readGitDiffFiles = async ({ cwd, base }: Params): Promise<string[]> => {
	const prefix = await readGitPrefix({ cwd });

	if (prefix === undefined) {
		throw new Error('not inside a git worktree — verify needs git-truth changed files');
	}

	const diff = await runCommand({ command: `git diff --name-only ${base} -- .`, cwd, timeoutMs: gitTimeoutMs }).catch((error: unknown) => {
		throw new Error(`git diff against ${base} failed: ${error instanceof Error ? error.message : String(error)}`);
	});

	if (diff.exitCode !== 0) {
		throw new Error(`git diff against ${base} failed (exit ${diff.exitCode}): ${diff.stderr.trim()}`);
	}

	return diff.stdout
		.split('\n')
		.filter(Boolean)
		.map((path) => (prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path))
		.filter((path) => !path.startsWith('.lightsout/'));
};
