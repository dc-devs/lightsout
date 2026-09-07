import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { jestReporterSource } from '#src/gates/testResults/jestReporterSource.ts';
import { getRunDir } from '#src/runState/index.ts';

interface Params {
	cwd: string;
	runId: string;
}

/**
 * Write the engine's jest reporter into the run folder and answer its absolute
 * path — the value the gate command's environment carries to every jest process
 * it starts.
 *
 * It overwrites on every call. The file is a few hundred bytes, and an engine
 * upgraded partway through a resumable run must never leave a stale reporter
 * behind for the rest of that run to be judged on.
 */
export const writeJestReporter = async ({ cwd, runId }: Params): Promise<string> => {
	const runDir = getRunDir({ cwd, runId });
	const reporterPath = join(runDir, 'jest-reporter.cjs');

	await mkdir(runDir, { recursive: true });
	await writeFile(reporterPath, jestReporterSource);

	return reporterPath;
};
