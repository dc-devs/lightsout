import type { RunLock } from '#src/contracts/index.ts';
import { isPidAlive } from '#src/runState/isPidAlive.ts';
import { readRunLock } from '#src/runState/lock/readRunLock.ts';

interface Params {
	/** The checkout whose `.lightsout/lock.json` is read — a worktree path, not the launching checkout. */
	cwd: string;
}

/**
 * The run holding a checkout right now, or undefined when nothing is running
 * in it.
 *
 * A worktree resolver asks this before it lets a second session into a tree
 * another one established: the ownership record says who cut the tree, which
 * outlives the run that cut it, and only a live lock says a run is still
 * editing the files. A lock whose process is gone is a crash leftover rather
 * than a holder, exactly as `isRunLive` judges it — otherwise one crashed run
 * would fence its ticket's tree off for good.
 */
export const readLiveRunLock = async ({ cwd }: Params): Promise<RunLock | undefined> => {
	const lock = await readRunLock({ cwd });

	return lock !== undefined && isPidAlive({ pid: lock.pid }) ? lock : undefined;
};
