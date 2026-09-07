import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { writeJestReporter } from '#src/gates/testResults/writeJestReporter.ts';

const runId = 'run-1';
const stale = '// a reporter an earlier engine wrote\n';

/**
 * A repo whose run folder already holds a stale reporter, so the answer states
 * both where the file goes and that an earlier copy is replaced rather than
 * kept — an engine upgraded partway through a resumable run must not leave the
 * old reporter behind.
 */
const setupStaleReporter = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-jest-reporter-'));
	const runDir = join(cwd, '.lightsout', 'runs', runId);

	mkdirSync(runDir, { recursive: true });
	writeFileSync(join(runDir, 'jest-reporter.cjs'), stale);

	return { cwd, runDir };
};

describe('writeJestReporter', () => {
	test('writeJestReporter: writes the reporter into the run folder and returns its absolute path', async () => {
		const { cwd, runDir } = setupStaleReporter();

		const reporterPath = await writeJestReporter({ cwd, runId });

		const written = readFileSync(reporterPath, 'utf8');
		// the path is handed to a child process through an environment variable,
		// so it has to be absolute and it has to name the run's own folder
		expect({ reporterPath, absolute: isAbsolute(reporterPath) }).toStrictEqual({
			reporterPath: join(runDir, 'jest-reporter.cjs'),
			absolute: true,
		});
		expect(written).not.toBe(stale);
		expect(written.length).toBeGreaterThan(0);
	});
});
