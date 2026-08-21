import type { RunListing } from '#src/contracts/index.ts';
import { listRunIds, readRunLock, readRunManifest } from '#src/runState/index.ts';
import { readRunListing } from '#src/views/common/utils/readRunListing.ts';

interface Params {
	cwd: string;
}

/**
 * Every run this repo has state for, newest first — the runs list, whole, with
 * no paging.
 *
 * A run whose manifest will not read is skipped in silence, the way `status` and
 * the health report skip one: a list is an account of what is readable, and one
 * corrupt directory must not take the whole history down with it.
 */
export const listRuns = async ({ cwd }: Params): Promise<RunListing[]> => {
	const lock = await readRunLock({ cwd });
	const listings: RunListing[] = [];

	for (const runId of await listRunIds({ cwd })) {
		const manifest = await readRunManifest({ cwd, runId }).catch(() => undefined);

		if (manifest === undefined) {
			continue;
		}

		listings.push(await readRunListing({ cwd, manifest, lock }));
	}

	return listings.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
};
