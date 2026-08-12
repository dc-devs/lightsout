import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { LightsoutConfig } from '@/contracts';
import { checkCoverageSummary } from '@/doctor/checkCoverageSummary';
import type { PackageDir } from '@/doctor/common/types/PackageDir';

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', testCoverage: 'pnpm test:coverage' };

const packageGates: NonNullable<LightsoutConfig['packageGates']> = {
	check: 'x {package}',
	test: 'x {package}',
	testCoverage: 'x {package}',
};

/** A repo root, plus whichever summary files the case says already exist. */
const setupRepo = ({ summaries = [] }: { summaries?: string[] } = {}) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-coverage-doctor-'));

	for (const summary of summaries) {
		mkdirSync(join(dir, summary, '..'), { recursive: true });
		writeFileSync(join(dir, summary), '{}');
	}

	return dir;
};

const packageDirs = ({ cwd, packages = [] }: { cwd: string; packages?: string[] }): PackageDir[] => [
	{ label: 'root', dir: cwd },
	...packages.map((label) => ({ label, dir: join(cwd, 'packages', label) })),
];

describe('checkCoverageSummary', () => {
	test('a repo that opted out of the coverage gate gets no check at all', async () => {
		const cwd = setupRepo();

		// nothing measures coverage here, so a missing summary is not a finding
		expect(await checkCoverageSummary({ config: { gates: { ...gates, testCoverage: false } }, packageDirs: packageDirs({ cwd }) })).toBe(undefined);
	});

	test('a single-package repo passes when the summary the run reads is on disk', async () => {
		const cwd = setupRepo({ summaries: ['coverage/coverage-summary.json'] });

		const check = await checkCoverageSummary({ config: { gates }, packageDirs: packageDirs({ cwd }) });

		expect(check?.status).toBe('pass');
		expect(check?.detail).toBe('coverage summary found for 1 scope(s)');
	});

	test('a missing summary warns with the reporter to configure — a fresh clone looks identical', async () => {
		const cwd = setupRepo();

		const check = await checkCoverageSummary({ config: { gates }, packageDirs: packageDirs({ cwd }) });

		// warn, not fail: a repo that has never run coverage is in this state too
		expect(check?.status).toBe('warn');
		expect(check?.detail).toBe('not found: root: coverage/coverage-summary.json');
		expect(check?.fix ?? '').toMatch(/json-summary/);
	});

	test('monorepo mode checks each package and never the root, exactly as the measurement runs', async () => {
		const cwd = setupRepo({ summaries: ['coverage/coverage-summary.json', 'packages/api/coverage/coverage-summary.json'] });
		const config: LightsoutConfig = {
			gates,
			packageGates: { check: 'x {package}', test: 'x {package}', testCoverage: 'x {package}' },
		};

		const check = await checkCoverageSummary({ config, packageDirs: packageDirs({ cwd, packages: ['api', 'web'] }) });

		// the root summary exists but is irrelevant here; web's absence is the finding
		expect(check?.status).toBe('warn');
		expect(check?.detail).toBe('not found: web: coverage/coverage-summary.json');
	});

	test('monorepo mode passes on the packages alone, counting them and never the root', async () => {
		const cwd = setupRepo({ summaries: ['packages/api/coverage/coverage-summary.json', 'packages/web/coverage/coverage-summary.json'] });

		const check = await checkCoverageSummary({ config: { gates, packageGates }, packageDirs: packageDirs({ cwd, packages: ['api', 'web'] }) });

		// the root has no summary and is never asked for one — the two packages are the whole measurement
		expect(check?.status).toBe('pass');
		expect(check?.detail).toBe('coverage summary found for 2 scope(s)');
		// a pass has nothing to fix
		expect(check?.fix).toBe(undefined);
	});

	test('every scope missing a summary is named in the one finding', async () => {
		const cwd = setupRepo();

		const check = await checkCoverageSummary({ config: { gates, packageGates }, packageDirs: packageDirs({ cwd, packages: ['api', 'web'] }) });

		expect(check?.status).toBe('warn');
		expect(check?.detail).toBe('not found: api: coverage/coverage-summary.json, web: coverage/coverage-summary.json');
	});

	test('packages that measure coverage are checked even when the root gate is opted out', async () => {
		const cwd = setupRepo({ summaries: ['packages/api/coverage/coverage-summary.json'] });

		const check = await checkCoverageSummary({
			config: { gates: { ...gates, testCoverage: false }, packageGates },
			packageDirs: packageDirs({ cwd, packages: ['api'] }),
		});

		// gates.testCoverage: false only opts the root out; the scoped command still measures
		expect(check?.status).toBe('pass');
		expect(check?.detail).toBe('coverage summary found for 1 scope(s)');
	});

	test('a monorepo whose scoped gates skip coverage is measured at the root, not per package', async () => {
		const cwd = setupRepo({ summaries: ['coverage/coverage-summary.json'] });
		const config: LightsoutConfig = { gates, packageGates: { check: 'x {package}', test: 'x {package}' } };

		const check = await checkCoverageSummary({ config, packageDirs: packageDirs({ cwd, packages: ['api'] }) });

		// packageGates alone does not move the measurement — only a scoped
		// testCoverage command does, and there is none here
		expect(check?.status).toBe('pass');
		expect(check?.detail).toBe('coverage summary found for 1 scope(s)');
	});

	test('a configured summary path is what every scope is checked for', async () => {
		const cwd = setupRepo({ summaries: ['reports/summary.json'] });

		const check = await checkCoverageSummary({ config: { gates, coverageSummaryPath: 'reports/summary.json' }, packageDirs: packageDirs({ cwd }) });

		expect(check?.status).toBe('pass');
	});
});
