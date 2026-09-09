import type { CommandResult } from '#src/common/types/CommandResult.ts';
import { quoteGitArgument } from '#src/ship/common/utils/quoteGitArgument.ts';
import { runGit } from '#src/ship/common/utils/runGit.ts';
import { hasOpenMerge } from '#src/ship/integration/common/utils/hasOpenMerge.ts';

interface Params {
	cwd: string;
	/** The commit `HEAD` was at before the merge began, snapshotted by `runShip` after the preconditions passed. */
	baselineCommit: string;
	onProgress?: (message: string) => void;
}

/** What is still wrong after the restore ran, or `undefined` when the branch really is back where it started. */
const describeRemainingState = async ({ cwd, baselineCommit }: { cwd: string; baselineCommit: string }) => {
	const head = await runGit({ command: 'git rev-parse HEAD', cwd });
	const status = await runGit({ command: 'git status --porcelain', cwd });

	if (head === undefined || head.exitCode !== 0 || status === undefined || status.exitCode !== 0) {
		return 'git could not be read after the restore, so the branch cannot be confirmed clean';
	}

	if (head.stdout.trim() !== baselineCommit) {
		return `HEAD is at ${head.stdout.trim()} rather than the baseline ${baselineCommit}`;
	}

	if (await hasOpenMerge({ cwd })) {
		return 'a merge is still in progress';
	}

	return status.stdout.trim() === '' ? undefined : `the working tree still carries ${status.stdout.trim().split('\n').length} uncommitted path(s)`;
};

/**
 * Put the branch back exactly where it stood before anything was integrated,
 * and say so only when that is verified.
 *
 * The merge is aborted when one is open — an absent merge is normal, not a
 * failure, and never stops the reset. `git clean -fd` and not `-fdx`: the
 * preconditions guarantee a clean tree at the baseline commit, so every
 * untracked file present afterwards came from the merge or from the agent —
 * but ignored build outputs are not the recovery's business, and deleting them
 * would cost the next run its cache.
 *
 * The caller checks that this attempt still owns the branch and the merge
 * before calling: this function resets what it is pointed at, so pointing it at
 * someone else's work is the one mistake it cannot catch for itself.
 *
 * @returns undefined when the restore is verified, else what failed and what is still left behind
 */
export const restorePreIntegrationState = async ({ cwd, baselineCommit, onProgress }: Params): Promise<string | undefined> => {
	onProgress?.(`integrate: restoring ${baselineCommit.slice(0, 8)} — nothing verified, so nothing is kept`);

	const aborted = (await hasOpenMerge({ cwd })) ? await runGit({ command: 'git merge --abort', cwd }) : undefined;
	const reset = await runGit({ command: `git reset --hard ${quoteGitArgument({ argument: baselineCommit })}`, cwd });
	const cleaned = await runGit({ command: 'git clean -fd', cwd });
	const remaining = await describeRemainingState({ cwd, baselineCommit });

	if (remaining === undefined) {
		return undefined;
	}

	const refused = [aborted, reset, cleaned]
		.filter((result): result is CommandResult => result !== undefined && result.exitCode !== 0)
		.map((result) => result.stderr.trim());

	return [remaining, ...refused].filter((line) => line !== '').join('; ');
};
