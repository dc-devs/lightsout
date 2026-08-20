import { readdir } from 'node:fs/promises';
import { type RunManifest, RunStatus } from '#src/contracts/index.ts';
import { getRunsDir, readRunManifest } from '#src/runState/index.ts';

interface Params {
	cwd: string;
	/** Overview path exactly as coordinator manifests store it (already normalized by the caller). */
	overviewPath: string;
}

/**
 * The most recently updated phased run for this overview that has not passed,
 * or undefined when there is none.
 *
 * A failed or paused sequence stopped short — resume continues it, so starting
 * a second one for the same overview would run phases twice. Only a passed
 * sequence is finished. Unreadable run dirs are skipped rather than guessed at.
 */
export const findUnfinishedSequence = async ({ cwd, overviewPath }: Params): Promise<RunManifest | undefined> => {
	const runIds = await readdir(getRunsDir({ cwd })).catch(() => []);
	const unfinished: RunManifest[] = [];

	for (const runId of runIds) {
		const manifest = await readRunManifest({ cwd, runId }).catch(() => undefined);

		if (manifest?.pipeline === 'phases' && manifest.plan === overviewPath && manifest.status !== RunStatus.Passed) {
			unfinished.push(manifest);
		}
	}

	return unfinished.sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt))[0];
};
