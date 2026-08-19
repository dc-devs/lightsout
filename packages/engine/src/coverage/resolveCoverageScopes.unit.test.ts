import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import type { LightsoutConfig } from '@/contracts';
import { resolveCoverageScopes } from '@/coverage/resolveCoverageScopes';

const summaryPath = 'coverage/coverage-summary.json';

const setupMonorepo = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-scopes-'));

	for (const [packageDir, scripts] of [
		['api', { 'test:coverage': 'x' }],
		['web', { 'test:coverage': 'x' }],
		['docs', {}],
	] as const) {
		mkdirSync(join(cwd, 'packages', packageDir), { recursive: true });
		writeFileSync(join(cwd, 'packages', packageDir, 'package.json'), JSON.stringify({ name: `@acme/${packageDir}`, scripts }));
	}

	return cwd;
};

/** A monorepo holding every shape the package walk must survive: a scriptless package, a directory with no manifest, a dot-directory, and a loose file. */
const setupSparseMonorepo = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-scopes-sparse-'));

	mkdirSync(join(cwd, 'packages', 'api'), { recursive: true });
	writeFileSync(join(cwd, 'packages', 'api', 'package.json'), JSON.stringify({ name: '@acme/api', scripts: {} }));
	mkdirSync(join(cwd, 'packages', 'orphan'), { recursive: true });
	mkdirSync(join(cwd, 'packages', '.cache'), { recursive: true });
	writeFileSync(join(cwd, 'packages', '.cache', 'package.json'), JSON.stringify({ name: '@acme/cache', scripts: {} }));
	writeFileSync(join(cwd, 'packages', 'notes.md'), '# not a package\n');

	return cwd;
};

/** A single package living somewhere other than `packages/`. */
const setupCustomPackagesDir = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-scopes-apps-'));

	mkdirSync(join(cwd, 'apps', 'web'), { recursive: true });
	writeFileSync(join(cwd, 'apps', 'web', 'package.json'), JSON.stringify({ name: '@acme/web', scripts: { 'test:coverage': 'x' } }));

	return cwd;
};

const scopedConfig = ({ testCoverage, packagesDir }: { testCoverage: string; packagesDir?: string }): LightsoutConfig => ({
	gates: { check: 'true', test: 'true', 'test-coverage': false },
	...(packagesDir === undefined ? {} : { 'packages-dir': packagesDir }),
	'package-gates': { check: 'true {package}', test: 'true {package}', 'test-coverage': testCoverage },
});

test('resolveCoverageScopes: root mode yields the single root scope for a string command, and nothing for an opted-out gate', async () => {
	const configured: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': 'npm run coverage' } };

	expect(await resolveCoverageScopes({ cwd: '/nowhere', config: configured, summaryPath })).toStrictEqual([
		{ scope: 'root', command: 'npm run coverage', summaryPath },
	]);
	// a foreign scope name never matches the root scope
	expect(await resolveCoverageScopes({ cwd: '/nowhere', config: configured, summaryPath, scope: 'api' })).toStrictEqual([]);

	const optedOut: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

	expect(await resolveCoverageScopes({ cwd: '/nowhere', config: optedOut, summaryPath })).toStrictEqual([]);
});

test('resolveCoverageScopes: monorepo mode lists every package with the template script, substitutes {package}, and narrows to a named scope', async () => {
	const cwd = setupMonorepo();
	const config: LightsoutConfig = {
		gates: { check: 'true', test: 'true', 'test-coverage': false },
		'package-gates': { check: 'true {package}', test: 'true {package}', 'test-coverage': 'pnpm --filter {package} run test:coverage' },
	};

	const all = await resolveCoverageScopes({ cwd, config, summaryPath });

	// docs has no test:coverage script — nothing to measure there, legitimately
	expect(all).toStrictEqual([
		{ scope: 'api', command: 'pnpm --filter @acme/api run test:coverage', summaryPath: join('packages', 'api', summaryPath) },
		{ scope: 'web', command: 'pnpm --filter @acme/web run test:coverage', summaryPath: join('packages', 'web', summaryPath) },
	]);

	const narrowed = await resolveCoverageScopes({ cwd, config, summaryPath, scope: 'web' });

	expect(narrowed.map((entry) => entry.scope)).toStrictEqual(['web']);
});

test('resolveCoverageScopes: narrowing to a package the repo does not have measures nothing', async () => {
	const cwd = setupMonorepo();
	const config = scopedConfig({ testCoverage: 'pnpm --filter {package} run test:coverage' });

	const scopes = await resolveCoverageScopes({ cwd, config, summaryPath, scope: 'ghost' });

	expect(scopes).toStrictEqual([]);
});

test('resolveCoverageScopes: a template naming no script keeps every package that has a manifest, and skips dot-directories and loose files', async () => {
	const cwd = setupSparseMonorepo();

	const scopes = await resolveCoverageScopes({ cwd, config: scopedConfig({ testCoverage: 'true {package}' }), summaryPath });

	// api has an empty scripts map, but there is no script name to look up — nothing to detect, nothing to skip
	expect(scopes).toStrictEqual([{ scope: 'api', command: 'true @acme/api', summaryPath: join('packages', 'api', summaryPath) }]);
});

test('resolveCoverageScopes: a custom packagesDir is where packages are looked for, and where their summaries land', async () => {
	const cwd = setupCustomPackagesDir();

	const scopes = await resolveCoverageScopes({
		cwd,
		config: scopedConfig({ testCoverage: 'pnpm --filter {package} run test:coverage', packagesDir: 'apps' }),
		summaryPath,
	});

	expect(scopes).toStrictEqual([{ scope: 'web', command: 'pnpm --filter @acme/web run test:coverage', summaryPath: join('apps', 'web', summaryPath) }]);
});

test('resolveCoverageScopes: a repo with no packages directory measures nothing rather than failing', async () => {
	const config = scopedConfig({ testCoverage: 'pnpm --filter {package} run test:coverage' });

	const scopes = await resolveCoverageScopes({ cwd: '/nowhere', config, summaryPath });

	expect(scopes).toStrictEqual([]);
});
