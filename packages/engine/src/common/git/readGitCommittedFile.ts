import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';

interface Params {
	cwd: string;
	/** Repo-relative path. */
	path: string;
}

/**
 * The file's content at `HEAD` (`git show HEAD:<path>`), undefined when `HEAD`
 * does not track it, outside a worktree, and on a timeout.
 *
 * It is what lets a check ask what pre-existed the run rather than what is on
 * disk right now: a run starts from a clean tree, so `HEAD` is exactly the
 * state before any agent wrote anything — and a step that re-enters after a
 * park reads the same answer as its first entry. Held to the same deadline and
 * the same never-throw contract as its neighbours — absence is a value.
 */
export const readGitCommittedFile = async ({ cwd, path }: Params): Promise<string | undefined> => {
	// The command runs through a shell, and a repo-relative path is data: single
	// quotes with the embedded-quote escape are what stop a path from becoming
	// shell syntax.
	const quoted = `'${path.replaceAll("'", `'\\''`)}'`;
	const shown = await runCommand({ command: `git show HEAD:${quoted}`, cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);

	return shown && shown.exitCode === 0 ? shown.stdout : undefined;
};
