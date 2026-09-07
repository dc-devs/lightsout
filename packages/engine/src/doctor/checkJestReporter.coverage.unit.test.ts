import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { checkJestReporter } from '#src/doctor/checkJestReporter.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

// The variable's name is written out rather than imported, so the test states
// the contract independently of the constant the check reads.
const reporterVariable = 'LIGHTSOUT_JEST_REPORTER';

/** The reporter named on its own, the shape a consumer adds first. */
const loadsReporter = [
	`const reporter = process.env.${reporterVariable};`,
	"module.exports = { reporters: reporter ? ['default', reporter] : ['default'] };",
].join('\n');

/** The same reporter given options — the `[path, options]` pair Jest also accepts. */
const loadsReporterWithOptions = [
	`const reporter = process.env.${reporterVariable};`,
	"module.exports = { reporters: reporter ? ['default', [reporter, { outputFile: 'results.json' }]] : ['default'] };",
].join('\n');

/** A config that cannot be loaded at all. */
const unloadable = 'module.exports = {';

/** The same settings wrapped under a `jest` key, the way a package.json carries them. */
const loadsReporterUnderJestKey = [
	`const reporter = process.env.${reporterVariable};`,
	"module.exports = { jest: { reporters: reporter ? ['default', reporter] : ['default'] } };",
].join('\n');

/**
 * A repository holding one Jest config per named package, run with the reporter
 * variable set to `priorReporter` — or unset when it is omitted.
 */
const setupRepo = ({ packages, priorReporter }: { packages: Record<string, string>; priorReporter?: string }) => {
	const env = { ...process.env };

	delete env[reporterVariable];

	if (priorReporter !== undefined) {
		env[reporterVariable] = priorReporter;
	}

	jest.replaceProperty(process, 'env', env);

	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-jest-reporter-coverage-'));

	const packageDirs = Object.entries(packages).map(([label, config]) => {
		writeRepoFile({ cwd, path: `packages/${label}/jest.config.cjs`, content: config });

		return { label, dir: join(cwd, 'packages', label) };
	});

	return { cwd, packageDirs };
};

describe('checkJestReporter', () => {
	test('accepts a reporters entry that gives the reporter options', async () => {
		const repo = setupRepo({ packages: { alpha: loadsReporterWithOptions } });

		const check = await checkJestReporter(repo);

		// a pair carries the same reporter as a bare path does, so a config that
		// configures it must not be reported as loading nothing
		expect(check).toEqual(expect.objectContaining({ id: 'jest-reporter', status: 'pass' }));
	});

	test('reads the settings a loaded module holds under a jest key', async () => {
		const repo = setupRepo({ packages: { alpha: loadsReporterUnderJestKey } });

		const check = await checkJestReporter(repo);

		// the outer object names no reporters at all, so a check that read it
		// instead of the `jest` key inside it would warn at a repository that is
		// already set up correctly
		expect(check).toEqual(expect.objectContaining({ id: 'jest-reporter', status: 'pass' }));
	});

	test('leaves the reporter variable at the value it found', async () => {
		const repo = setupRepo({ packages: { alpha: loadsReporter }, priorReporter: '/prior/jest-reporter.cjs' });

		const check = await checkJestReporter(repo);

		// the check names its own reporter for the length of a load and hands the
		// value back — a doctor run inside a live run must not leave the process
		// pointing at a probe path
		expect({ status: check?.status, reporter: process.env[reporterVariable] }).toStrictEqual({
			status: 'pass',
			reporter: '/prior/jest-reporter.cjs',
		});
	});

	test('leaves the reporter variable unset when it found it unset', async () => {
		const repo = setupRepo({ packages: { alpha: loadsReporter } });

		const check = await checkJestReporter(repo);

		// the probe path is removed rather than left behind, where every later
		// config in this process would read it as a reporter to load
		expect({ status: check?.status, reporter: process.env[reporterVariable] }).toStrictEqual({ status: 'pass', reporter: undefined });
	});

	test('passes a repository whose only unanswered config is one it could not load', async () => {
		const repo = setupRepo({ packages: { alpha: loadsReporter, broken: unloadable } });

		const check = await checkJestReporter(repo);

		// nothing is known about a config that would not load, so it is named as
		// unchecked and the repository is not warned at for it
		expect(check).toEqual(
			expect.objectContaining({
				id: 'jest-reporter',
				status: 'pass',
				detail: expect.stringMatching(/broken[\s\S]*unchecked/),
			}),
		);
	});
});
