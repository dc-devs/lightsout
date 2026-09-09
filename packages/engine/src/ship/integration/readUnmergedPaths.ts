import { runGit } from '#src/ship/common/utils/runGit.ts';

interface Params {
	cwd: string;
}

/**
 * The repo-relative paths git currently considers unmerged, or `undefined` when
 * git could not be read at all.
 *
 * Undefined and empty are deliberately different answers, exactly as in
 * `readGitHeadCommit`: an unreadable git is missing evidence, and reporting it
 * as "nothing unmerged" would let an unresolved conflict be committed.
 *
 * Read NUL-delimited and never trimmed, because a path is data: a filename may
 * carry spaces, quotes, a leading space or a newline, and every one of those
 * survives here rather than being reshaped into something git never said.
 */
export const readUnmergedPaths = async ({ cwd }: Params): Promise<string[] | undefined> => {
	const listed = await runGit({ command: 'git diff --name-only --diff-filter=U -z', cwd });

	if (listed === undefined || listed.exitCode !== 0) {
		return undefined;
	}

	return listed.stdout.split('\0').filter((path) => path !== '');
};
