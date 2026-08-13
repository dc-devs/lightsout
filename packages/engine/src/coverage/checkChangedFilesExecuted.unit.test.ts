import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import type { LightsoutConfig } from '@/contracts';
import { checkChangedFilesExecuted } from '@/coverage/checkChangedFilesExecuted';

// Runtime require rather than a static import: the CJS TypeScript compiler
// probes __filename at load, so it has to be required at runtime rather than
// pulled into the module graph. ts-jest transpiles this file to CommonJS, where
// `require` is already the local resolver — `import.meta` does not exist there.
const ts = require('typescript') as typeof import('typescript');

const rootConfig: LightsoutConfig = { gates: { check: 'true', test: 'true', testCoverage: 'npm run coverage' } };

const setupRepo = ({
	files,
	summary,
	summaryAt = 'coverage/coverage-summary.json',
}: {
	files: Record<string, string>;
	summary?: Record<string, { covered: number; total: number }>;
	summaryAt?: string;
}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-executed-'));

	for (const [name, content] of Object.entries(files)) {
		mkdirSync(join(cwd, dirname(name)), { recursive: true });
		writeFileSync(join(cwd, name), content);
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

test('checkChangedFilesExecuted: an empty changed set, a missing compiler, or an unconfigured gate all pass without reading anything', async () => {
	expect(await checkChangedFilesExecuted({ cwd: '/nowhere', config: rootConfig, changedFiles: [], compiler: ts })).toBe(undefined);
	expect(await checkChangedFilesExecuted({ cwd: '/nowhere', config: rootConfig, changedFiles: ['src/a.ts'], compiler: undefined })).toBe(undefined);

	const optedOut: LightsoutConfig = { gates: { check: 'true', test: 'true', testCoverage: false } };
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
		gates: { check: 'true', test: 'true', testCoverage: false },
		packageGates: { check: 'true {package}', test: 'true {package}', testCoverage: 'pnpm --filter {package} run test:coverage' },
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
	const config: LightsoutConfig = { ...rootConfig, coverageSummaryPath: 'reports/summary.json' };

	const error = await checkChangedFilesExecuted({ cwd, config, changedFiles: ['src/cold.ts'], compiler: ts });

	// looking at the default path would report a missing summary instead of the file's own verdict
	expect(error).toContain('never executed under the tests: src/cold.ts');
});

test('checkChangedFilesExecuted: a package whose coverage command was never configured is outside the measurement', async () => {
	const config: LightsoutConfig = {
		gates: { check: 'true', test: 'true', testCoverage: false },
		packageGates: { check: 'true {package}', test: 'true {package}', testCoverage: 'pnpm --filter {package} run test:coverage' },
	};
	const cwd = setupUnmeasuredPackage();

	const error = await checkChangedFilesExecuted({ cwd, config, changedFiles: ['packages/docs/src/cold.ts'], compiler: ts });

	// no command measures docs, so there is no summary to demand — and none is demanded
	expect(error).toBe(undefined);
});
