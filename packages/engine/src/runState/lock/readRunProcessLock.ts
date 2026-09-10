import { stat } from 'node:fs/promises';
import type { RunLock, RunManifest } from '#src/contracts/index.ts';
import { readRunLock } from '#src/runState/lock/readRunLock.ts';

interface Params {
	/** The checkout the reader was launched from — where the run's records live. */
	cwd: string;
	/** The run whose holder is wanted; its recorded `workspace` is where its lock is. */
	manifest: RunManifest;
}

/**
 * The lock of the checkout this run's process actually holds, rather than the
 * lock of the checkout the reader happens to be standing in.
 *
 * The run lock is `<checkout>/.lightsout/lock.json` and is deliberately
 * per-checkout — that is what lets two worktrees of one repository each hold a
 * live run. An isolated run therefore takes its lock in its workspace while its
 * manifest is written back to the checkout the command was launched from, so a
 * reader that kept asking its own checkout would find no holder and brand every
 * healthy isolated run a crash leftover.
 *
 * A recorded workspace that has since been removed falls back rather than
 * failing: a reader asking who holds a run is never the right place to report a
 * missing directory. Whether the holder means the run is live stays
 * `isRunLive`'s judgment, unchanged.
 */
export const readRunProcessLock = async ({ cwd, manifest }: Params): Promise<RunLock | undefined> => {
	const { workspace } = manifest;
	const recorded =
		workspace === undefined
			? undefined
			: await stat(workspace).then(
					(entry) => (entry.isDirectory() ? workspace : undefined),
					() => undefined,
				);

	return readRunLock({ cwd: recorded ?? cwd });
};
