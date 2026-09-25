import { PipelineKind } from '#src/contracts/run/PipelineKind.ts';
import type { RunLock } from '#src/contracts/run/RunLock.ts';
import type { RunManifest } from '#src/contracts/run/RunManifest.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { RunListing } from '#src/contracts/views/RunListing.ts';
import { isRunLive } from '#src/runState/isRunLive.ts';
import { isRunResumable } from '#src/runState/isRunResumable.ts';
import type { FrozenWorklist } from '#src/views/internal/common/types/FrozenWorklist.ts';
import { getRunTitle } from '#src/views/internal/common/utils/getRunTitle.ts';

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
		planName: manifest.planName,
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
