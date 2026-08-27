import type { StandardsPackListing } from '#src/contracts/index.ts';
import { toStandardsPackListing } from '#src/views/common/utils/toStandardsPackListing.ts';
import { listStandardsPackBundles } from '#src/views/listStandardsPackBundles.ts';

interface Params {
	cwd: string;
}

/**
 * The packs this repo loads, as the packs page lists them — identity and counts,
 * no rules.
 *
 * Never throws. A repo with no config, no pack beside it and nothing bundled
 * above it answers with an empty list, and the page says so; the reason is in the
 * server log.
 *
 * @param cwd - the repo whose config decides which packs load
 */
export const listStandardsPacks = async ({ cwd }: Params): Promise<StandardsPackListing[]> => {
	const bundles = await listStandardsPackBundles({ cwd });

	return bundles.map((bundle) => toStandardsPackListing({ bundle }));
};
