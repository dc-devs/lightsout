import type { RunManifest } from '#src/contracts/index.ts';
import { isRunLive, readRunProcessLock } from '#src/runState/index.ts';

interface Params {
	/** The checkout whose run locks are read, which is always the primary one. */
	primaryCheckout: string;
	/** The source folder's own top-level runs, as `readLooseFileRuns` answered them. */
	runs: RunManifest[];
}

/** Moving a folder out from under a run that is still editing it is the one thing a plan made from that folder cannot do. */
export const findLiveRunRefusal = async ({ primaryCheckout, runs }: Params): Promise<string | undefined> => {
	const locks = await Promise.all(runs.map((manifest) => readRunProcessLock({ cwd: primaryCheckout, manifest })));
	const live = runs.find((manifest, index) => isRunLive({ manifest, lock: locks[index] }));

	return live === undefined
		? undefined
		: `run ${live.runId} is still building ${live.plan}, and making a plan out of the folder would move the files out from under it — wait for that run to finish, or stop it, and run this again`;
};
