import { realpath } from 'node:fs/promises';
import { relative, sep } from 'node:path';
import type { TestResultsFile } from '#src/contracts/index.ts';

interface Params {
	cwd: string;
	results: TestResultsFile['testResults'];
}

/** A runner can report the checkout's physical path; normalize that alias without following individual test-file symlinks. */
export const normalizeTestResults = async ({ cwd, results }: Params): Promise<TestResultsFile['testResults']> => {
	const physical = await realpath(cwd);
	const inside = (path: string) => path !== '..' && !path.startsWith(`..${sep}`);
	return results.map((file) => {
		const direct = relative(cwd, file.testFilePath);
		const resolved = relative(physical, file.testFilePath);
		return { ...file, testFilePath: inside(direct) || !inside(resolved) ? direct : resolved };
	});
};
