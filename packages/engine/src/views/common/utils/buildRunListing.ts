import { PipelineKind, type RunListing, type RunLock, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import { isRunLive, isRunResumable } from '#src/runState/index.ts';
import type { FrozenWorklist } from '#src/views/common/types/FrozenWorklist.ts';
import { getRunTitle } from '#src/views/common/utils/getRunTitle.ts';

interface Params {
	manifest: RunManifest;
	lock: RunLock | undefined;
	worklist?: FrozenWorklist;
}

/**
 * One manifest folded into a list row.
 *
 * Reads nothing but the manifest and the repo lock — no JSONL file is opened —
 * so listing every run a repo has stays cheap however long its history gets.
 */
export const buildRunListing = ({ manifest, lock, worklist }: Params): RunListing => {
	const live = isRunLive({ manifest, lock });

	return {
		runId: manifest.runId,
		shortId: manifest.runId.slice(0, 8),
		pipeline: manifest.pipeline ?? PipelineKind.Implement,
		status: manifest.status,
		title: getRunTitle({ plan: manifest.plan, worklist }),
		plan: manifest.plan,
		createdAt: manifest.createdAt,
		updatedAt: manifest.updatedAt,
		live,
		packages: manifest.packages,
		stepsPassed: manifest.steps.filter((step) => step.status === RunStatus.Passed).length,
		stepCount: manifest.steps.length,
		changedFileCount: manifest.changedFiles.length,
		costUsd: manifest.usage?.costUsd,
		parentRunId: manifest.parentRunId,
		resumable: isRunResumable({ status: manifest.status, live }),
	};
};
