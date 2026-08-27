import type { RunListing, RunLock, RunManifest } from '#src/contracts/index.ts';
import type { FrozenWorklist } from '#src/views/common/types/FrozenWorklist.ts';
import { buildRunListing } from '#src/views/common/utils/buildRunListing.ts';
import { readFrozenWorklist } from '#src/views/common/utils/readFrozenWorklist.ts';

interface Params {
	cwd: string;
	manifest: RunManifest;
	lock: RunLock | undefined;
	/** The run's frozen work-list when the caller already read it — the run detail reads it once and shares it with the burn-down. */
	worklist?: FrozenWorklist;
}

/**
 * One run's list row, work-list and all.
 *
 * Shared by the runs list and the run detail page so the sidebar row and the
 * detail header can never disagree about a run's title, whether it is live, or
 * whether resuming it would do anything.
 */
export const readRunListing = async ({ cwd, manifest, lock, worklist }: Params): Promise<RunListing> => {
	const frozen = worklist ?? (manifest.plan.endsWith('worklist.json') ? await readFrozenWorklist({ cwd, manifest }) : undefined);

	return buildRunListing({ manifest, lock, worklist: frozen });
};
