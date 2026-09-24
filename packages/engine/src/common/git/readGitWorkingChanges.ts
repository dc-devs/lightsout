import { GitChangeKind } from '#src/common/constants/GitChangeKind.ts';
import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { readGitPrefix } from '#src/common/git/readGitPrefix.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';
import type { GitWorkingChange } from '#src/common/types/GitWorkingChange.ts';

interface Params {
	cwd: string;
}

/**
 * A porcelain status code read into a kind. The `D` is read first so a file
 * added and then deleted within the run (`AD`) is never taken for a file on
 * disk.
 */
const kindOf = ({ code }: { code: string }) => {
	let kind: GitChangeKind = GitChangeKind.Modified;

	if (code.includes('D')) {
		kind = GitChangeKind.Removed;
	} else if (code === '??' || code.includes('A')) {
		kind = GitChangeKind.Added;
	}

	return kind;
};

/**
 * Every path currently changed under `cwd` (paths relative to `cwd`), with
 * whether it was added, modified or removed relative to `HEAD`, read from
 * `git status`.
 *
 * A sibling of `readGitChangedFiles`, which answers a different question — the
 * files that now exist — and so collapses a move to its destination. Here a move
 * is read with `--no-renames` as the removal of its old path and the addition of
 * its new one, because a caller comparing each change against `HEAD` needs both
 * sides of it. Returns undefined when `cwd` is not inside a git worktree or the
 * command fails. Run state under `.lightsout/` is never reported.
 */
export const readGitWorkingChanges = async ({ cwd }: Params): Promise<GitWorkingChange[] | undefined> => {
	const prefix = await readGitPrefix({ cwd });

	if (prefix === undefined) {
		return undefined;
	}

	const status = await runCommand({ command: 'git status --porcelain=v1 -uall --no-renames -- .', cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);

	if (status?.exitCode !== 0) {
		return undefined;
	}

	// Porcelain paths are repo-root-relative; strip the cwd's prefix so they
	// line up with the repo-relative paths agents report.
	return status.stdout
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const path = line.slice(3).replace(/^"|"$/g, '');

			return { path: prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path, kind: kindOf({ code: line.slice(0, 2) }) };
		})
		.filter((change) => !change.path.startsWith('.lightsout/'));
};
