import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { jestReporterSource } from '#src/gates/testResults/jestReporterSource.ts';

/**
 * Loads the written reporter the way Jest does — require the file, construct the
 * class it exports, hand it one finished run — and prints its own process id, so
 * a test can tell which process wrote which results file.
 */
const loadReporterScript = `
const { readFileSync } = require('node:fs');

const [reporterPath, resultsPath] = process.argv.slice(1);
const loaded = require(reporterPath);
const Reporter = loaded && loaded.default ? loaded.default : loaded;
const reporter = new Reporter({}, {});
const results = JSON.parse(readFileSync(resultsPath, 'utf8'));

Promise.resolve(reporter.onRunComplete(new Set(), results)).then(() => {
	process.stdout.write(String(process.pid));
});
`;

/**
 * One finished run as Jest hands it to a reporter: two test files, a nested
 * passing case, and a pending one Jest timed as null.
 */
const aggregatedResult = {
	testResults: [
		{
			testFilePath: '/repo/packages/engine/src/gates/runGates.unit.test.ts',
			testResults: [
				{ title: 'runs every configured gate', ancestorTitles: ['runGates'], fullName: 'runGates runs every configured gate', status: 'passed', duration: 12 },
				{
					title: 'skips a missing script',
					ancestorTitles: ['runGates', 'when a script is absent'],
					fullName: 'runGates when a script is absent skips a missing script',
					status: 'pending',
					duration: null,
				},
			],
		},
		{
			testFilePath: '/repo/packages/engine/src/gates/createGateRunner.unit.test.ts',
			testResults: [{ title: 'records the command it ran', ancestorTitles: [], fullName: 'records the command it ran', status: 'failed', duration: 3 }],
		},
	],
};

/**
 * The reporter source written to a file of its own, plus a run of it in a child
 * process — so the results-directory variable is set for that process alone and
 * this suite's own environment is never touched.
 */
const setupReporter = ({ withResultsDir = true }: { withResultsDir?: boolean } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-jest-reporter-'));

	const reporterPath = join(cwd, 'jest-reporter.cjs');
	writeFileSync(reporterPath, jestReporterSource);

	const resultsPath = join(cwd, 'results.json');
	writeFileSync(resultsPath, JSON.stringify(aggregatedResult));

	const resultsDir = join(cwd, 'test-results');
	const env: NodeJS.ProcessEnv = { ...process.env, LIGHTSOUT_TEST_RESULTS_DIR: resultsDir };
	if (!withResultsDir) {
		delete env.LIGHTSOUT_TEST_RESULTS_DIR;
	}

	const run = () => {
		const child = spawnSync(process.execPath, ['-e', loadReporterScript, reporterPath, resultsPath], { cwd, env, encoding: 'utf8' });

		// on a crash the child's own stderr becomes the failure message, rather than a bare exit code
		return { failure: child.status === 0 ? '' : child.stderr, pid: child.stdout.trim() };
	};

	return { cwd, resultsDir, run };
};

describe('jestReporterSource', () => {
	test('jestReporterSource: writes one results file per process holding every assertion result', () => {
		const { resultsDir, run } = setupReporter();

		const outcome = run();

		expect(outcome.failure).toBe('');
		const written = readdirSync(resultsDir);
		expect(written).toHaveLength(1);
		expect(written[0]).toContain(outcome.pid);
		const results = JSON.parse(readFileSync(join(resultsDir, written[0]), 'utf8')) as { testResults: unknown };
		expect(results.testResults).toStrictEqual([
			{
				testFilePath: '/repo/packages/engine/src/gates/runGates.unit.test.ts',
				assertionResults: [
					{
						title: 'runs every configured gate',
						ancestorTitles: ['runGates'],
						fullName: 'runGates runs every configured gate',
						status: 'passed',
						durationMs: 12,
					},
					{
						title: 'skips a missing script',
						ancestorTitles: ['runGates', 'when a script is absent'],
						fullName: 'runGates when a script is absent skips a missing script',
						status: 'pending',
					},
				],
			},
			{
				testFilePath: '/repo/packages/engine/src/gates/createGateRunner.unit.test.ts',
				assertionResults: [
					{ title: 'records the command it ran', ancestorTitles: [], fullName: 'records the command it ran', status: 'failed', durationMs: 3 },
				],
			},
		]);
	});

	test('jestReporterSource: is inert when the results directory environment variable is unset', () => {
		const { cwd, resultsDir, run } = setupReporter({ withResultsDir: false });

		const outcome = run();

		expect(outcome.failure).toBe('');
		expect(existsSync(resultsDir)).toBe(false);
		expect(readdirSync(cwd).sort()).toStrictEqual(['jest-reporter.cjs', 'results.json']);
	});
});
