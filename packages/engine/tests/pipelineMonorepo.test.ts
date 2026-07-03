import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Driver } from '@lightsout/drivers';
import { loadConfig, runImplementPipeline } from '../src/index';
import { readGateLog } from './helpers/readGateLog';
import { report } from './helpers/report';
import { roleOf } from './helpers/roleOf';
import { setupMonorepo } from './helpers/setupMonorepo';

test('front-matter scope: scoped clean-slate, name substitution, expansion, root group', async () => {
	const dir = setupMonorepo();
	let cleanSlateGates: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'write-tests') {
				const target = prompt.match(/- (\S+)/)?.[1] ?? 'unknown';
				const parts = target.split('/');
				const testDir = target.startsWith('packages/') ? `${parts[0]}/${parts[1]}/test` : 'test';
				const testFile = `${testDir}/${parts.at(-1)?.replace('.js', '')}.test.js`;

				mkdirSync(join(dir, testDir), { recursive: true });
				writeFileSync(join(dir, testFile), '// stub test\n');

				return { text: report({ changedFiles: [{ path: testFile, summary: 'tests' }] }), exitCode: 0 };
			}

			if (role !== 'implement') {
				return { text: report(), exitCode: 0 };
			}

			// Clean-slate has already run — snapshot its gate log, then stray
			// outside the declared scope (web) and into the root (shared.js).
			cleanSlateGates = readGateLog({ dir });
			writeFileSync(join(dir, 'packages/api/src/feature.js'), 'export const feature = () => 2;\n');
			writeFileSync(join(dir, 'packages/web/src/widget.js'), 'export const widget = () => 2;\n');
			writeFileSync(join(dir, 'shared.js'), 'export const shared = () => 2;\n');

			return {
				text: report({
					changedFiles: [
						{ path: 'packages/api/src/feature.js', summary: 'feature' },
						{ path: 'packages/web/src/widget.js', summary: 'widget' },
						{ path: 'shared.js', summary: 'shared' },
					],
				}),
				exitCode: 0,
			};
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });
	const allGates = readGateLog({ dir });
	const postImplementGates = allGates.slice(cleanSlateGates.length);

	assert.equal(result.ok, true, result.error);
	assert.ok(cleanSlateGates.some((line) => line.startsWith('@acme/api ')), 'clean-slate ran the declared package');
	assert.ok(!cleanSlateGates.some((line) => line.startsWith('@acme/web ')), 'clean-slate skipped undeclared packages');
	assert.ok(!cleanSlateGates.some((line) => line.startsWith('root ')), 'clean-slate skipped the root group');
	assert.ok(!allGates.some((line) => line.startsWith('api ')), '{package} used the package.json name, not the directory');
	assert.ok(postImplementGates.some((line) => line.startsWith('@acme/web ')), 'scope expanded to the strayed-into package');
	assert.ok(postImplementGates.some((line) => line.startsWith('root ')), 'root group joined after a root file changed');
	assert.ok(allGates.some((line) => line === '@acme/api coverage'), 'coverage ran scoped');
	assert.deepEqual([...result.manifest.packages].sort(), ['api', 'web']);
	assert.equal(result.manifest.packagesSource, 'front-matter');
});

test('no scope anywhere: hard error before any gate or agent', async () => {
	const dir = setupMonorepo({ plan: '# Plan: vague, names no packages\n' });
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('no agent should be invoked');
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

	assert.equal(result.manifest.status, 'failed');
	assert.match(result.error ?? '', /no package scope/);
	assert.deepEqual(readGateLog({ dir }), [], 'no gates ran');
});

test('--packages flag overrides front-matter; source recorded as flag', async () => {
	const dir = setupMonorepo(); // front-matter declares api
	let cleanSlateGates: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (roleOf(prompt) !== 'implement') {
				return { text: report(), exitCode: 0 };
			}

			cleanSlateGates = readGateLog({ dir });
			writeFileSync(join(dir, 'packages/web/src/widget.js'), 'export const widget = () => 2;\n');

			return { text: report({ changedFiles: [{ path: 'packages/web/src/widget.js', summary: 'widget' }] }), exitCode: 0 };
		},
	};
	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await loadConfig({ cwd: dir }),
		planPath: 'plan.md',
		packages: ['web'],
	});

	assert.equal(result.ok, true, result.error);
	assert.ok(cleanSlateGates.some((line) => line.startsWith('@acme/web ')));
	assert.ok(!cleanSlateGates.some((line) => line.startsWith('@acme/api ')));
	assert.equal(result.manifest.packagesSource, 'flag');
});

test('scope derived from concrete plan-body paths when nothing is declared', async () => {
	const dir = setupMonorepo({ plan: '# Plan: fix api\n\nEdit `packages/api/src/index.js`; nothing else.\n' });
	let cleanSlateGates: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (roleOf(prompt) !== 'implement') {
				return { text: report(), exitCode: 0 };
			}

			cleanSlateGates = readGateLog({ dir });
			writeFileSync(join(dir, 'packages/api/src/feature.js'), 'export const feature = () => 2;\n');

			return { text: report({ changedFiles: [{ path: 'packages/api/src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

	assert.equal(result.ok, true, result.error);
	assert.deepEqual(result.manifest.packages, ['api']);
	assert.equal(result.manifest.packagesSource, 'plan-paths');
	assert.ok(cleanSlateGates.some((line) => line.startsWith('@acme/api ')));
	assert.ok(!cleanSlateGates.some((line) => line.startsWith('@acme/web ')));
});

test('a declared package without package.json fails its gate group with a clear error', async () => {
	const dir = setupMonorepo({ plan: '---\npackages:\n  - ghost\n---\n# Plan\n' });
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			throw new Error('no agent should be invoked — clean-slate must fail first');
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }), planPath: 'plan.md' });

	assert.equal(result.manifest.status, 'failed');
	assert.match(result.error ?? '', /ghost.*no package\.json|no package\.json.*ghost/);
});
