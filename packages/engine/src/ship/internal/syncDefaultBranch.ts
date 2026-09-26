import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';

interface Params {
	cwd: string;
	defaultBranch: string;
	/** The branch that was just merged, whose local copy is now redundant. */
	branch: string;
	/** Live progress sink — one line per step, and one per step that did not work. */
	onProgress?: (message: string) => void;
}

/**
 * Whether this checkout is a linked worktree rather than the primary one. The
 * two git directories agree in a primary checkout and differ in a linked one;
 * an unreadable answer counts as primary, so the cleanup below still tries.
 */
const isLinkedWorktree = async ({ cwd }: { cwd: string }) => {
	const result = await runCommand({ command: 'git rev-parse --git-dir --git-common-dir', cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);

	if (result === undefined || result.exitCode !== 0) {
		return false;
	}

	const [gitDir, commonDir] = result.stdout.trim().split('\n');

	return gitDir !== undefined && commonDir !== undefined && gitDir !== commonDir;
};

/**
 * The local half of the cleanup the forge already did remotely: move to the
 * default branch, fast-forward it, and drop the merged branch.
 *
 * Skipped entirely in a linked worktree: the default branch lives in the
 * primary checkout, git refuses to check it out a second time, and the
 * worktree is removed moments later anyway — three failure lines per ship that
 * a reader learns to ignore teach them to ignore the fourth that matters.
 *
 * `git branch -d` rather than `-D`, so a branch git does not consider merged is
 * left alone rather than destroyed — the forge may have squashed, and a squash
 * leaves the local commits unreachable from the default branch.
 *
 * Every step is best effort. The merge has already happened by the time this
 * runs, so a checkout that fails on a stale index must not turn a shipped
 * result into a blocked one — that would tell a tracker skill the work did not
 * ship when it did.
 */
export const syncDefaultBranch = async ({ cwd, defaultBranch, branch, onProgress }: Params): Promise<void> => {
	if (await isLinkedWorktree({ cwd })) {
		onProgress?.('sync: skipped — this checkout is a linked worktree, and the default branch lives in the primary one');

		return;
	}

	const steps = [`git checkout ${defaultBranch}`, 'git pull --ff-only', `git branch -d ${branch}`];

	for (const command of steps) {
		const result = await runCommand({ command, cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);

		onProgress?.(result?.exitCode === 0 ? `sync: ${command}` : `sync: ${command} did not work — leaving the local tree as it is`);
	}
};
