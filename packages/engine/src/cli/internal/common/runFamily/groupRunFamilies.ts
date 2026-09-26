import { getRunFamilyRoot } from '#src/cli/internal/common/runFamily/getRunFamilyRoot.ts';
import type { RunFamily } from '#src/cli/internal/common/types/RunFamily.ts';
import type { RunListing } from '#src/contracts/views/RunListing.ts';

interface Params {
	runs: RunListing[];
}

/**
 * Run listings grouped into families, keyed by root.
 *
 * A phased plan has two live manifests at once — the coordinator and the phase
 * child it started — and counting those as two separate runs would call every
 * phased run ambiguous and refuse to watch any of them. They share a root, so
 * they are one family and one choice.
 *
 * Each family keeps the order the listings arrived in, which for `listRuns` is
 * newest updated first.
 */
export const groupRunFamilies = ({ runs }: Params): RunFamily[] => {
	const families = new Map<string, RunListing[]>();

	for (const run of runs) {
		const root = getRunFamilyRoot({ run });

		families.set(root, [...(families.get(root) ?? []), run]);
	}

	return [...families].map(([root, grouped]) => ({ root, runs: grouped }));
};
