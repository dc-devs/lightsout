import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { writeJsonFile } from '#src/common/utils/writeJsonFile.ts';
import type { StandardsSnapshot } from '#src/contracts/index.ts';
import { getRunStandardsBaselinePath } from '#src/runState/standardsBaseline/getRunStandardsBaselinePath.ts';

interface Params {
	cwd: string;
	runId: string;
	snapshot: StandardsSnapshot;
}

/**
 * Persist one run's pre-edit standards baseline — the deterministic findings as
 * they stood before the run's first agent turn, which is what later tells a
 * violation this run made from debt it inherited.
 *
 * The same bytes every other engine record is written in, so the run's baseline
 * and the repo's own snapshot read alike in a diff and parse through one
 * contract. No dated copy beside it: a trend over a single run's one baseline
 * has nothing to plot.
 */
export const writeRunStandardsBaseline = async ({ cwd, runId, snapshot }: Params): Promise<void> => {
	const path = getRunStandardsBaselinePath({ cwd, runId });

	// The first run to reach clean-slate has no run folder yet.
	await mkdir(dirname(path), { recursive: true });
	await writeJsonFile({ path, value: snapshot });
};
