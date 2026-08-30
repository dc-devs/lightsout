import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { checkChangedFilesExecuted } from '#src/coverage/checkChangedFilesExecuted.ts';

// Runtime require rather than a static import: the CJS TypeScript compiler
// probes __filename at load, so it has to be required at runtime rather than
// pulled into the module graph. ts-jest transpiles this file to CommonJS, where
// `require` is already the local resolver — `import.meta` does not exist there.
const ts = require('typescript') as typeof import('typescript');

const rootConfig: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': 'npm run coverage' } };

/** A CommonJS jest config exporting the given settings verbatim. */
const cjsConfig = ({ settings }: { settings: Record<string, unknown> }) => `module.exports = ${JSON.stringify(settings)};\n`;

const setupRepo = ({
	files,
	summary,
	summaryAt = 'coverage/coverage-summary.json',
	jestConfig,
}: {
	files: Record<string, string>;
	summary?: Record<string, { covered: number; total: number }>;
	summaryAt?: string;
	/** A jest config at the repo root, plus the package.json script `rootConfig`'s coverage command runs. Omitted, the repo has no coverage configuration and every file reads as collected. */
	jestConfig?: { name?: string; source: string };
}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-executed-'));

	for (const [name, content] of Object.entries(files)) {
		mkdirSync(join(cwd, dirname(name)), { recursive: true });
		writeFileSync(join(cwd, name), content);
	}

	if (jestConfig) {
		const name = jestConfig.name ?? 'jest.config.cjs';

		writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', scripts: { coverage: `jest -c ${name} --coverage` } }));
		writeFileSync(join(cwd, name), jestConfig.source);
	}

	if (summary) {
		const path = join(cwd, summaryAt);

		mkdirSync(dirname(path), { recursive: true });
		// Istanbul writes absolute keys plus a total entry; other metrics ride along.
		writeFileSync(
			path,
			JSON.stringify({
				total: { statements: { pct: 80, covered: 8, total: 10 }, branches: { pct: 50 } },
				...Object.fromEntries(
					Object.entries(summary).map(([file, statements]) => [join(cwd, file), { statements: { pct: 0, ...statements }, lines: { pct: 1 } }]),
				),
			}),
		);
	}

	return cwd;
};

/** A monorepo whose one package never defined the coverage script the template names — so no command measures it. */
const setupUnmeasuredPackage = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-executed-unmeasured-'));

	mkdirSync(join(cwd, 'packages', 'docs', 'src'), { recursive: true });
	writeFileSync(join(cwd, 'packages', 'docs', 'package.json'), JSON.stringify({ name: '@acme/docs', scripts: {} }));
	writeFileSync(join(cwd, 'packages', 'docs', 'src', 'cold.ts'), 'export const cold = () => 1;');

	return cwd;
};

/** A monorepo whose packages live somewhere other than `packages/`, each measuring itself. */
const setupCustomPackagesDir = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-executed-apps-'));

	mkdirSync(join(cwd, 'apps', 'web', 'src'), { recursive: true });
	mkdirSync(join(cwd, 'apps', 'web', 'coverage'), { recursive: true });
	writeFileSync(join(cwd, 'apps', 'web', 'package.json'), JSON.stringify({ name: '@acme/web', scripts: { 'test:coverage': 'x' } }));
	writeFileSync(join(cwd, 'apps', 'web', 'src', 'cold.ts'), 'export const cold = () => 1;');
	writeFileSync(
		join(cwd, 'apps', 'web', 'coverage', 'coverage-summary.json'),
		JSON.stringify({
			total: { statements: { pct: 50, covered: 1, total: 2 } },
			[join(cwd, 'apps', 'web', 'src', 'cold.ts')]: { statements: { pct: 0, covered: 0, total: 2 } },
		}),
	);

	return cwd;
};

test('checkChangedFilesExecuted: an empty changed set, a missing compiler, or an unconfigured gate all pass without reading anything', async () => {
	expect(await checkChangedFilesExecuted({ cwd: '/nowhere', config: rootConfig, changedFiles: [], compiler: ts })).toBe(undefined);
	expect(await checkChangedFilesExecuted({ cwd: '/nowhere', config: rootConfig, changedFiles: ['src/a.ts'], compiler: undefined })).toBe(undefined);

	const optedOut: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
	const cwd = setupRepo({ files: { 'src/a.ts': 'export const a = () => 1;' } });

	// no scope owns the file — outside the measurement, outside the check
	expect(await checkChangedFilesExecuted({ cwd, config: optedOut, changedFiles: ['src/a.ts'], compiler: ts })).toBe(undefined);
});

test('checkChangedFilesExecuted: executed files pass; zero-covered and unmeasured files fail with the named gate error', async () => {
	const cwd = setupRepo({
		files: {
			'src/ran.ts': 'export const ran = () => 1;',
			'src/cold.ts': 'export const cold = () => 2;',
			'src/absent.ts': 'export const absent = () => 3;',
		},
		summary: { 'src/ran.ts': { covered: 3, total: 3 }, 'src/cold.ts': { covered: 0, total: 4 } },
	});

	const error = await checkChangedFilesExecuted({ cwd, config: rootConfig, changedFiles: ['src/ran.ts', 'src/cold.ts', 'src/absent.ts'], compiler: ts });

	expect(error).toBe(
		"changed-file-execution: 2 changed file(s) never executed under the tests: src/cold.ts, src/absent.ts — cover each through its public subject's tests; a file no test can reach through a public surface is a wiring defect to fix in source.",
	);
});

test('checkChangedFilesExecuted: deleted, inert, test, and zero-total files are legitimately absent from coverage', async () => {
	const cwd = setupRepo({
		files: {
			'src/barrel.ts': "export { ran } from './ran';",
			'src/ran.ts': 'export const ran = () => 1;',
			'src/ran.unit.test.ts': 'export const irrelevant = 1;',
		},
		summary: { 'src/ran.ts': { covered: 1, total: 1 }, 'src/barrel.ts': { covered: 0, total: 0 } },
	});

	// src/gone.ts is in the changed set but not on disk — nothing to execute
	const error = await checkChangedFilesExecuted({
		cwd,
		config: rootConfig,
		changedFiles: ['src/barrel.ts', 'src/ran.ts', 'src/ran.unit.test.ts', 'src/gone.ts'],
		compiler: ts,
	});

	expect(error).toBe(undefined);
});

test('checkChangedFilesExecuted: a missing summary fails with the doctor guidance only when a candidate belongs to that scope', async () => {
	const cwd = setupRepo({ files: { 'src/a.ts': 'export const a = () => 1;' } });

	const error = await checkChangedFilesExecuted({ cwd, config: rootConfig, changedFiles: ['src/a.ts'], compiler: ts });

	expect(error).toContain('no readable coverage summary at coverage/coverage-summary.json after the root coverage command ran');
	expect(error).toContain('lightsout doctor');
});

test('checkChangedFilesExecuted: monorepo mode reads each package summary, and root files sit outside the measurement', async () => {
	const config: LightsoutConfig = {
		gates: { check: 'true', test: 'true', 'test-coverage': false },
		'package-gates': { check: 'true {package}', test: 'true {package}', 'test-coverage': 'pnpm --filter {package} run test:coverage' },
	};
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-executed-mono-'));

	mkdirSync(join(cwd, 'packages', 'api', 'src'), { recursive: true });
	writeFileSync(join(cwd, 'packages', 'api', 'package.json'), JSON.stringify({ name: '@acme/api', scripts: { 'test:coverage': 'x' } }));
	writeFileSync(join(cwd, 'packages', 'api', 'src', 'cold.ts'), 'export const cold = () => 1;');
	writeFileSync(join(cwd, 'root.ts'), 'export const root = () => 2;');
	mkdirSync(join(cwd, 'packages', 'api', 'coverage'), { recursive: true });
	writeFileSync(
		join(cwd, 'packages', 'api', 'coverage', 'coverage-summary.json'),
		JSON.stringify({
			total: { statements: { pct: 50, covered: 1, total: 2 } },
			[join(cwd, 'packages', 'api', 'src', 'cold.ts')]: { statements: { pct: 0, covered: 0, total: 2 } },
		}),
	);

	// root.ts maps to no package scope — skipped; the package's cold file fails
	const error = await checkChangedFilesExecuted({ cwd, config, changedFiles: ['packages/api/src/cold.ts', 'root.ts'], compiler: ts });

	expect(error).toContain('changed-file-execution: 1 changed file(s) never executed under the tests: packages/api/src/cold.ts');
});

test('checkChangedFilesExecuted: a changed set with nothing executable left in it never opens a report at all', async () => {
	const cwd = setupRepo({ files: { 'README.md': '# notes\n' } });

	// no summary was ever written here, so reading one would be a hard error — and none is read
	const error = await checkChangedFilesExecuted({ cwd, config: rootConfig, changedFiles: ['README.md', 'src/gone.ts'], compiler: ts });

	expect(error).toBe(undefined);
});

test('checkChangedFilesExecuted: a file the report measures as having no executable statements has nothing to hold to the bar', async () => {
	const cwd = setupRepo({
		files: { 'src/settings.ts': "export const settings = { level: process.env.LEVEL ?? 'info' };" },
		summary: { 'src/settings.ts': { covered: 0, total: 0 } },
	});

	const error = await checkChangedFilesExecuted({ cwd, config: rootConfig, changedFiles: ['src/settings.ts'], compiler: ts });

	expect(error).toBe(undefined);
});

test('checkChangedFilesExecuted: a configured summary path is read instead of the Istanbul default', async () => {
	const cwd = setupRepo({
		files: { 'src/cold.ts': 'export const cold = () => 1;' },
		summary: { 'src/cold.ts': { covered: 0, total: 4 } },
		summaryAt: 'reports/summary.json',
	});
	const config: LightsoutConfig = { ...rootConfig, 'coverage-summary-path': 'reports/summary.json' };

	const error = await checkChangedFilesExecuted({ cwd, config, changedFiles: ['src/cold.ts'], compiler: ts });

	// looking at the default path would report a missing summary instead of the file's own verdict
	expect(error).toContain('never executed under the tests: src/cold.ts');
});

test('checkChangedFilesExecuted: a package whose coverage command was never configured is outside the measurement', async () => {
	const config: LightsoutConfig = {
		gates: { check: 'true', test: 'true', 'test-coverage': false },
		'package-gates': { check: 'true {package}', test: 'true {package}', 'test-coverage': 'pnpm --filter {package} run test:coverage' },
	};
	const cwd = setupUnmeasuredPackage();

	const error = await checkChangedFilesExecuted({ cwd, config, changedFiles: ['packages/docs/src/cold.ts'], compiler: ts });

	// no command measures docs, so there is no summary to demand — and none is demanded
	expect(error).toBe(undefined);
});

test('checkChangedFilesExecuted: in root mode a file under the packages directory sits outside the single root measurement', async () => {
	const cwd = setupRepo({ files: { 'packages/api/src/cold.ts': 'export const cold = () => 1;' } });

	// no summary was written here, so a file this check held to the bar would come
	// back with the missing-summary error rather than a pass
	const error = await checkChangedFilesExecuted({ cwd, config: rootConfig, changedFiles: ['packages/api/src/cold.ts'], compiler: ts });

	expect(error).toBe(undefined);
});

test('checkChangedFilesExecuted: a configured packages directory is where a changed file’s scope is looked up', async () => {
	const config: LightsoutConfig = {
		gates: { check: 'true', test: 'true', 'test-coverage': false },
		'packages-dir': 'apps',
		'package-gates': { check: 'true {package}', test: 'true {package}', 'test-coverage': 'pnpm --filter {package} run test:coverage' },
	};
	const cwd = setupCustomPackagesDir();

	const error = await checkChangedFilesExecuted({ cwd, config, changedFiles: ['apps/web/src/cold.ts'], compiler: ts });

	// under the default 'packages' this file would map to no scope at all and pass unmeasured
	expect(error).toContain('changed-file-execution: 1 changed file(s) never executed under the tests: apps/web/src/cold.ts');
});

// Run a22d44e6 (and dd34d3c4, the same shape one phase later): nine .ts files
// added under a standards pack's code/**/fixtures/ tree, which the pack's own
// `!**/fixtures/**` negation keeps out of every coverage report.
test('checkChangedFilesExecuted: a fixture file the config negates is exempt, while a collected file absent from the report still fails', async () => {
	const cwd = setupRepo({
		files: {
			'code/rule/fixtures/bad.ts': 'export const bad = () => 1;',
			'code/rule/check.ts': 'export const check = () => 2;',
			'src/cold.ts': 'export const cold = () => 3;',
		},
		summary: { 'code/rule/check.ts': { covered: 2, total: 2 } },
		jestConfig: { source: cjsConfig({ settings: { collectCoverageFrom: ['**/*.ts', '!**/*.unit.test.ts', '!**/fixtures/**'] } }) },
	});

	const error = await checkChangedFilesExecuted({
		cwd,
		config: rootConfig,
		changedFiles: ['code/rule/fixtures/bad.ts', 'code/rule/check.ts', 'src/cold.ts'],
		compiler: ts,
	});

	// the fixture is absent from the summary and exempt; the collected file is
	// absent from the summary and is not — the teeth stay on
	expect(error).toBe(
		"changed-file-execution: 1 changed file(s) never executed under the tests: src/cold.ts — cover each through its public subject's tests; a file no test can reach through a public surface is a wiring defect to fix in source.",
	);
});

// Run 00dd4d49: a pack-root fixtures/framework-owned/ tree — fixtures one level
// up, with no rule folder above them.
test('checkChangedFilesExecuted: a fixture tree at the pack root is exempt just as one inside a rule folder is', async () => {
	const cwd = setupRepo({
		files: {
			'fixtures/framework-owned/route.ts': 'export const route = () => 1;',
			'src/ran.ts': 'export const ran = () => 2;',
		},
		summary: { 'src/ran.ts': { covered: 1, total: 1 } },
		jestConfig: { source: cjsConfig({ settings: { collectCoverageFrom: ['**/*.ts', '!**/fixtures/**'] } }) },
	});

	const error = await checkChangedFilesExecuted({
		cwd,
		config: rootConfig,
		changedFiles: ['fixtures/framework-owned/route.ts', 'src/ran.ts'],
		compiler: ts,
	});

	expect(error).toBe(undefined);
});

// Run 81d6e3ef: four files uncollected by omission — the positives name .ts and
// the files are .tsx, so no glob matches them at all.
test('checkChangedFilesExecuted: a file the positives never name is exempt by omission, not only by negation', async () => {
	const cwd = setupRepo({
		files: { 'src/App.tsx': 'export const App = () => 1;', 'src/ran.ts': 'export const ran = () => 2;' },
		summary: { 'src/ran.ts': { covered: 1, total: 1 } },
		jestConfig: { source: cjsConfig({ settings: { collectCoverageFrom: ['src/**/*.ts'] } }) },
	});

	const error = await checkChangedFilesExecuted({ cwd, config: rootConfig, changedFiles: ['src/App.tsx', 'src/ran.ts'], compiler: ts });

	expect(error).toBe(undefined);
});

test('checkChangedFilesExecuted: a changed set that is entirely uncollected never opens a report at all', async () => {
	const cwd = setupRepo({
		files: { 'code/rule/fixtures/bad.ts': 'export const bad = () => 1;' },
		jestConfig: { source: cjsConfig({ settings: { collectCoverageFrom: ['**/*.ts', '!**/fixtures/**'] } }) },
	});

	// no summary was ever written here, so reading one would be a hard error — and none is read
	const error = await checkChangedFilesExecuted({ cwd, config: rootConfig, changedFiles: ['code/rule/fixtures/bad.ts'], compiler: ts });

	expect(error).toBe(undefined);
});

// Run df85a9b8: a folder rename inside an excluded tree, which reaches git as a
// delete plus an add for every file in it.
test('checkChangedFilesExecuted: a folder rename inside an excluded tree passes on both halves of the change', async () => {
	const cwd = setupRepo({
		files: { 'code/rule/fixtures/renamed/bad.ts': 'export const bad = () => 1;' },
		jestConfig: { source: cjsConfig({ settings: { collectCoverageFrom: ['**/*.ts', '!**/fixtures/**'] } }) },
	});

	// the old path is gone from disk and the new one sits in the excluded tree
	const error = await checkChangedFilesExecuted({
		cwd,
		config: rootConfig,
		changedFiles: ['code/rule/fixtures/old/bad.ts', 'code/rule/fixtures/renamed/bad.ts'],
		compiler: ts,
	});

	expect(error).toBe(undefined);
});

test('checkChangedFilesExecuted: a configuration the engine cannot require leaves the file failing exactly as before', async () => {
	const cwd = setupRepo({
		files: { 'src/cold.ts': 'export const cold = () => 1;' },
		summary: { 'src/other.ts': { covered: 1, total: 1 } },
		jestConfig: {
			name: 'jest.config.ts',
			// a real jest.config.ts imports its preset — unresolvable here, so the require throws
			source: ["import { createDefaultPreset } from 'ts-jest';", '', 'export default { ...createDefaultPreset(), collectCoverageFrom: [] };'].join('\n'),
		},
	});

	const error = await checkChangedFilesExecuted({ cwd, config: rootConfig, changedFiles: ['src/cold.ts'], compiler: ts });

	// the config would exempt everything if it could be read; unreadable, it exempts nothing
	expect(error).toContain('never executed under the tests: src/cold.ts');
});

test('checkChangedFilesExecuted: in monorepo mode a package’s unit config is located through its coverage script’s -c argument', async () => {
	const config: LightsoutConfig = {
		gates: { check: 'true', test: 'true', 'test-coverage': false },
		'package-gates': { check: 'true {package}', test: 'true {package}', 'test-coverage': 'pnpm --filter {package} run test:coverage' },
	};
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-executed-mono-config-'));

	mkdirSync(join(cwd, 'packages', 'api', 'src', 'fixtures'), { recursive: true });
	mkdirSync(join(cwd, 'packages', 'api', 'coverage'), { recursive: true });
	writeFileSync(
		join(cwd, 'packages', 'api', 'package.json'),
		JSON.stringify({ name: '@acme/api', scripts: { 'test:coverage': 'jest -c jest.config.cjs --coverage' } }),
	);
	writeFileSync(join(cwd, 'packages', 'api', 'jest.config.cjs'), cjsConfig({ settings: { collectCoverageFrom: ['src/**/*.ts', '!**/fixtures/**'] } }));
	// the e2e suite measures everything, including the fixtures the unit suite skips
	writeFileSync(join(cwd, 'packages', 'api', 'jest.e2e.config.cjs'), cjsConfig({ settings: { collectCoverageFrom: ['**/*.ts'] } }));
	writeFileSync(join(cwd, 'packages', 'api', 'src', 'fixtures', 'sample.ts'), 'export const sample = () => 1;');
	writeFileSync(join(cwd, 'packages', 'api', 'src', 'ran.ts'), 'export const ran = () => 2;');
	writeFileSync(
		join(cwd, 'packages', 'api', 'coverage', 'coverage-summary.json'),
		JSON.stringify({
			total: { statements: { pct: 100, covered: 1, total: 1 } },
			[join(cwd, 'packages', 'api', 'src', 'ran.ts')]: { statements: { pct: 100, covered: 1, total: 1 } },
		}),
	);

	const error = await checkChangedFilesExecuted({
		cwd,
		config,
		changedFiles: ['packages/api/src/fixtures/sample.ts', 'packages/api/src/ran.ts'],
		compiler: ts,
	});

	expect(error).toBe(undefined);
});
