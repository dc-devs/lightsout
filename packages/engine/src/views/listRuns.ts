import type { RunListing } from '#src/contracts/index.ts';
import { listRunIds, readRunManifest, readRunProcessLock } from '#src/runState/index.ts';
import { readRunListing } from '#src/views/common/utils/readRunListing.ts';

interface Params {
	cwd: string;
	/** Narrow the read to one ticket's runs folder; without it, every run this repo has. */
	workOrderName?: string;
}

/**
 * Every run this repo has state for, newest first — the runs list, whole, with
 * no paging. Given a ticket branch, only that ticket's own runs folder is read,
 * which is what keeps a plan's row from opening every run on disk.
 *
 * A run whose manifest will not read is skipped in silence, the way `status` and
 * the health report skip one: a list is an account of what is readable, and one
 * corrupt directory must not take the whole history down with it.
 */
export const listRuns = async ({ cwd, workOrderName }: Params): Promise<RunListing[]> => {
	const listings: RunListing[] = [];

	for (const runId of await listRunIds({ cwd, workOrderName })) {
		const manifest = await readRunManifest({ cwd, runId }).catch(() => undefined);

		if (manifest === undefined) {
			continue;
		}

		// Per run rather than once: the run lock is per-checkout, so an isolated
		// run's holder is in the workspace it recorded rather than here.
		listings.push(await readRunListing({ cwd, manifest, lock: await readRunProcessLock({ cwd, manifest }) }));
	}

	return listings.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
};
