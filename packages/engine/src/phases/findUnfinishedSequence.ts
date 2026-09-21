import { PipelineKind, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import { listRunIds, readRunManifest } from '#src/runState/index.ts';

interface Params {
	cwd: string;
	/** The plan a fresh sequence would be started for, or undefined when the overview belongs to no plan. */
	planName: string | undefined;
}

/**
 * The most recently updated phased run for this plan that has not passed, or
 * undefined when there is none.
 *
 * A failed or paused sequence stopped short — resume continues it, so starting
 * a second one for the same plan would run phases twice. Only a passed sequence
 * is finished. Unreadable run dirs are skipped rather than guessed at.
 *
 * The match is the plan each coordinator recorded rather than how its overview
 * path was spelled, so a re-spelled path no longer hides a mid-flight sequence.
 * An overview outside any plan folder records no name, and a sequence with no
 * name to match blocks nothing.
 */
export const findUnfinishedSequence = async ({ cwd, planName }: Params): Promise<RunManifest | undefined> => {
	if (planName === undefined) {
		return undefined;
	}

	const runIds = await listRunIds({ cwd });
	const unfinished: RunManifest[] = [];

	for (const runId of runIds) {
		const manifest = await readRunManifest({ cwd, runId }).catch(() => undefined);

		if (manifest?.pipeline === PipelineKind.Phases && manifest.planName === planName && manifest.status !== RunStatus.Passed) {
			unfinished.push(manifest);
		}
	}

	return unfinished.sort((first, second) => Date.parse(second.updatedAt) - Date.parse(first.updatedAt))[0];
};
