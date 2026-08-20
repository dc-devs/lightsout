import { readdir } from 'node:fs/promises';
import { getRunsDir } from '#src/runState/common/paths/getRunsDir.ts';

interface Params {
	cwd: string;
}

/**
 * Every run id this repo has state for, sorted.
 *
 * A repo that has never run anything has no runs directory at all, which is an
 * empty list rather than an error — reports that aggregate across runs must be
 * runnable on a repo with no history.
 */
export const listRunIds = async ({ cwd }: Params): Promise<string[]> => {
	const entries = await readdir(getRunsDir({ cwd }), { withFileTypes: true }).catch(() => []);

	return entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
};
