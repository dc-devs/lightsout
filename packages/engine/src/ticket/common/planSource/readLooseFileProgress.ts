import { PipelineKind, PlanProgress, type RunManifest, RunStatus } from '#src/contracts/index.ts';

interface Params {
	/** The source folder's own top-level runs, as `readLooseFileRuns` answered them. */
	runs: RunManifest[];
	/** Whether the folder holds a plan deliverable, which is what separates ready to implement from still being planned. */
	hasDeliverable: boolean;
}

/**
 * How far the source folder's implementation got, as the new plan's progress. A
 * passed top-level run is the whole answer; otherwise the folder's own implement
 * runs say where it stopped, while a phases coordinator that did NOT pass says
 * nothing on its own, since each of its phases is a run this rule excludes.
 */
export const readLooseFileProgress = ({ runs, hasDeliverable }: Params): PlanProgress => {
	const latest = runs
		.filter((manifest) => manifest.pipeline !== PipelineKind.Phases)
		.sort((left, right) => (left.createdAt < right.createdAt ? -1 : 1))
		.at(-1);
	let progress: PlanProgress = hasDeliverable ? PlanProgress.Ready : PlanProgress.Planning;

	if (latest !== undefined) {
		progress = latest.status === RunStatus.Failed || latest.status === RunStatus.Escalated ? PlanProgress.Failed : PlanProgress.Implementing;
	}

	// A run that passed wins over the latest one that did not: the folder was
	// built at least once, and a later repair attempt does not take that back.
	if (runs.some((manifest) => manifest.status === RunStatus.Passed)) {
		progress = PlanProgress.Implemented;
	}

	return progress;
};
