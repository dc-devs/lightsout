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
 * The local half of the cleanup the forge already did remotely: move to the
 * default branch, fast-forward it, and drop the merged branch.
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
	const steps = [`git checkout ${defaultBranch}`, 'git pull --ff-only', `git branch -d ${branch}`];

	for (const command of steps) {
		const result = await runCommand({ command, cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);

		onProgress?.(result?.exitCode === 0 ? `sync: ${command}` : `sync: ${command} did not work — leaving the local tree as it is`);
	}
};
