import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { readJsonFile } from '#src/common/utils/readJsonFile.ts';
import { TestResultsFile } from '#src/contracts/index.ts';

interface Params {
	cwd: string;
	/** Absolute path of one gate execution's results directory. */
	dir: string;
}

/**
 * Every per-test result one gate execution left behind, merged across the jest
 * processes that wrote them, with each test file path made repo-relative — the
 * runner reports absolute paths and every caller compares against repo-relative
 * ones.
 *
 * A directory that is missing, unreadable or empty answers an empty list, and so
 * does a results file that is truncated or off-contract. Absence is a value
 * here: the callers each decide what an empty answer means, and they mean
 * different things — a row that cannot be proved, or a reporter that never
 * loaded.
 */
export const readTestResults = async ({ cwd, dir }: Params): Promise<TestResultsFile['testResults']> => {
	const entries: string[] = await readdir(dir).catch(() => []);
	const merged: TestResultsFile['testResults'] = [];

	for (const entry of entries.filter((name) => name.endsWith('.json'))) {
		const parsed = await readJsonFile({ path: join(dir, entry), schema: TestResultsFile });

		merged.push(...(parsed?.testResults ?? []).map((file) => ({ ...file, testFilePath: relative(cwd, file.testFilePath) })));
	}

	return merged;
};
