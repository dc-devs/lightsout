import { readGitPrefix } from '@/common/git/readGitPrefix';
import { runCommand } from '@/common/utils/runCommand';

const gitTimeoutMs = 60_000;

interface Params {
	cwd: string;
}

/**
 * List every file currently modified or untracked under `cwd` (paths relative
 * to `cwd`), read from `git status`. This is the engine's second source of
 * changed-file truth: agents report what they changed, git reports what
 * actually changed — and git cannot be sweet-talked. Returns undefined when
 * `cwd` is not inside a git worktree; the engine then degrades to
 * agent-reported files only. Run state under `.lightsout/` is never reported.
 */
export const readGitChangedFiles = async ({ cwd }: Params) => {
	const prefix = await readGitPrefix({ cwd });

	if (prefix === undefined) {
		return undefined;
	}

	const status = await runCommand({ command: 'git status --porcelain=v1 -uall -- .', cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);

	if (!status || status.exitCode !== 0) {
		return undefined;
	}

	// Porcelain paths are repo-root-relative; strip the cwd's prefix so they
	// line up with the repo-relative paths agents report.
	const root = prefix;

	return status.stdout
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const path = line.slice(3);
			// A rename is recorded as `old -> new`; only the destination is a file
			// that now exists. Indexed from the last arrow rather than split, so
			// there is no impossible "no segments" case to guard against.
			const arrow = path.lastIndexOf(' -> ');
			const renameTarget = arrow === -1 ? path : path.slice(arrow + ' -> '.length);

			return renameTarget.replace(/^"|"$/g, '');
		})
		.map((path) => (root && path.startsWith(root) ? path.slice(root.length) : path))
		.filter((path) => !path.startsWith('.lightsout/'));
};
