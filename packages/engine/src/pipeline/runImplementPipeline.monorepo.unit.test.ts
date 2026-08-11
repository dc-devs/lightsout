import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readGateLog } from '@tests/helpers/readGateLog';
import { report } from '@tests/helpers/report';
import { reviewReport } from '@tests/helpers/reviewReport';
import { roleOf } from '@tests/helpers/roleOf';
import { setupMonorepo } from '@tests/helpers/setupMonorepo';
import { loadConfig } from '@/common/utils/loadConfig';
import type { Driver } from '@/drivers';
import { runImplementPipeline } from '@/pipeline';

test('front-matter scope: scoped clean-slate, name substitution, expansion, root group', async () => {
	const dir = setupMonorepo();
	let cleanSlateGates: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

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

	expect(result.ok).toBe(true);
	// clean-slate ran the declared package
	expect(cleanSlateGates.some((line) => line.startsWith('@acme/api '))).toBeTruthy();
	// clean-slate skipped undeclared packages
	expect(cleanSlateGates.some((line) => line.startsWith('@acme/web '))).toBeFalsy();
	// clean-slate skipped the root group
	expect(cleanSlateGates.some((line) => line.startsWith('root '))).toBeFalsy();
	// {package} used the package.json name, not the directory
	expect(allGates.some((line) => line.startsWith('api '))).toBeFalsy();
	// scope expanded to the strayed-into package
	expect(postImplementGates.some((line) => line.startsWith('@acme/web '))).toBeTruthy();
	// root group joined after a root file changed
	expect(postImplementGates.some((line) => line.startsWith('root '))).toBeTruthy();
	// coverage ran scoped
	expect(allGates.some((line) => line === '@acme/api coverage')).toBeTruthy();
	expect([...result.manifest.packages].sort()).toStrictEqual(['api', 'web']);
	expect(result.manifest.packagesSource).toBe('front-matter');

	const commandLog = readFileSync(join(dir, '.lightsout', 'runs', result.manifest.runId, 'commands.jsonl'), 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line) as Record<string, unknown>);

	// command log labels package groups
	expect(commandLog.some((entry) => entry.group === 'api')).toBeTruthy();
	// command log labels the root group
	expect(commandLog.some((entry) => entry.group === 'root')).toBeTruthy();
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

	expect(result.manifest.status).toBe('failed');
	expect(result.error ?? '').toMatch(/no package scope/);
	// no gates ran
	expect(readGateLog({ dir })).toStrictEqual([]);
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

	expect(result.ok).toBe(true);
	expect(cleanSlateGates.some((line) => line.startsWith('@acme/web '))).toBeTruthy();
	expect(cleanSlateGates.some((line) => line.startsWith('@acme/api '))).toBeFalsy();
	expect(result.manifest.packagesSource).toBe('flag');
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

	expect(result.ok).toBe(true);
	expect(result.manifest.packages).toStrictEqual(['api']);
	expect(result.manifest.packagesSource).toBe('plan-paths');
	expect(cleanSlateGates.some((line) => line.startsWith('@acme/api '))).toBeTruthy();
	expect(cleanSlateGates.some((line) => line.startsWith('@acme/web '))).toBeFalsy();
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

	expect(result.manifest.status).toBe('failed');
	expect(result.error ?? '').toMatch(/ghost.*no package\.json|no package\.json.*ghost/);
});
