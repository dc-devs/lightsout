import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { readGateLog } from '#tests/helpers/readGateLog.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupMonorepo } from '#tests/helpers/setupMonorepo.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

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
			writeSource({ dir, path: 'packages/api/src/feature.js', source: 'export const feature = () => 2;\n' });
			writeSource({ dir, path: 'packages/web/src/widget.js', source: 'export const widget = () => 2;\n' });
			writeSource({ dir, path: 'shared.js', source: 'export const shared = () => 2;\n' });

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
	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });
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
	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });

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
			writeSource({ dir, path: 'packages/web/src/widget.js', source: 'export const widget = () => 2;\n' });

			return { text: report({ changedFiles: [{ path: 'packages/web/src/widget.js', summary: 'widget' }] }), exitCode: 0 };
		},
	};
	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await readConfig({ cwd: dir }),
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
			writeSource({ dir, path: 'packages/api/src/feature.js', source: 'export const feature = () => 2;\n' });

			return { text: report({ changedFiles: [{ path: 'packages/api/src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });

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
	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });

	expect(result.manifest.status).toBe('failed');
	expect(result.error ?? '').toMatch(/ghost.*no package\.json|no package\.json.*ghost/);
});

/**
 * A monorepo run parked mid-flight: implement lands a file in the declared
 * package, then the write-tests invocation is rate-limited, leaving a resumable
 * manifest whose scope is already settled.
 */
const setupParkedMonorepoRun = async () => {
	const dir = setupMonorepo();
	const config = await readConfig({ cwd: dir });
	const parkOnWrite: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				return { text: '', exitCode: 1, rateLimited: true };
			}

			if (role === 'implement') {
				writeSource({ dir, path: 'packages/api/src/feature.js', source: 'export const feature = () => 2;\n' });

				return { text: report({ changedFiles: [{ path: 'packages/api/src/feature.js', summary: 'feature' }] }), exitCode: 0 };
			}

			return { text: report(), exitCode: 0 };
		},
	};
	const parked = await runImplementPipeline({ cwd: dir, driver: parkOnWrite, config, planPath: 'plan.md' });
	const resumeDriver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => (roleOf(prompt) === 'standards-review' ? { text: reviewReport(), exitCode: 0 } : { text: report(), exitCode: 0 }),
	};

	return { dir, config, parked, resumeDriver };
};

test('a resumed manifest with no recorded scope origin still narrates its scope, attributed to the manifest', async () => {
	const { dir, config, parked, resumeDriver } = await setupParkedMonorepoRun();
	const progress: string[] = [];

	// `packagesSource` is optional on the contract, so a manifest written before
	// the origin was recorded is a legitimate resume input
	const resumed = await runImplementPipeline({
		cwd: dir,
		driver: resumeDriver,
		config,
		existing: { ...parked.manifest, packagesSource: undefined },
		onProgress: (message) => progress.push(message),
	});

	// the settled scope survives the resume untouched — it is never re-derived
	expect(resumed.manifest.packages).toStrictEqual(['api']);
	// and it is attributed to the manifest rather than narrated as `undefined`
	expect(progress.includes('package scope: api (from manifest)')).toBeTruthy();
});
