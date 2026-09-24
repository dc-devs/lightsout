import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';

interface Params {
	/** The worktree whose index is read — the directory `git add -A -- .` staged. */
	cwd: string;
	/** The most diff characters handed back; the rest is cut. */
	maxDiffLength: number;
}

/**
 * Read what is staged under `cwd`: the file list and the diff a commit made now
 * would carry.
 *
 * The `-- .` pathspec keeps the read to the directory `commitWorkOrderWork`
 * stages, and the wide stat width keeps long paths whole. Only the diff is cut
 * to `maxDiffLength` — the stat is the complete record of what changed, so it is
 * never cut. Either read failing answers undefined, never an empty change: an
 * index nobody could read has not been shown to hold nothing.
 */
export const readGitStagedChange = async ({ cwd, maxDiffLength }: Params): Promise<{ stat: string; diff: string; truncated: boolean } | undefined> => {
	const diffCommand = 'git -c core.quotePath=false diff --cached --no-color --no-ext-diff';
	const [stat, diff] = await Promise.all([
		runCommand({ command: `${diffCommand} --stat=1000 -- .`, cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined),
		runCommand({ command: `${diffCommand} -- .`, cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined),
	]);

	if (stat?.exitCode !== 0 || diff?.exitCode !== 0) {
		return undefined;
	}

	const truncated = diff.stdout.length > maxDiffLength;

	return { stat: stat.stdout, diff: truncated ? diff.stdout.slice(0, maxDiffLength) : diff.stdout, truncated };
};
