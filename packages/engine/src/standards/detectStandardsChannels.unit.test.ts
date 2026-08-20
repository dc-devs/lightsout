import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { loadConfig } from '#src/common/utils/loadConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { detectStandardsChannels } from '#src/standards/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupMonorepo } from '#tests/helpers/setupMonorepo.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

const writePackage = ({
	dir,
	name,
	deps,
	devDeps,
	peerDeps,
}: {
	dir: string;
	name: string;
	deps?: Record<string, string>;
	devDeps?: Record<string, string>;
	peerDeps?: Record<string, string>;
}) => {
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, 'package.json'),
		JSON.stringify({
			name,
			...(deps ? { dependencies: deps } : {}),
			...(devDeps ? { devDependencies: devDeps } : {}),
			...(peerDeps ? { peerDependencies: peerDeps } : {}),
		}),
	);
};

const writeRawManifest = ({ dir, contents }: { dir: string; contents: string }) => {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'package.json'), contents);
};

test('detectStandardsChannels reads scoped package dependencies', async () => {
	const dir = setupMonorepo();

	writePackage({ dir: join(dir, 'packages/web'), name: '@acme/web', deps: { preact: '^10.0.0' } });
	writePackage({ dir: join(dir, 'packages/site'), name: '@acme/site', deps: { react: '^19.0.0', '@tanstack/react-start': '^1.0.0' } });

	expect(await detectStandardsChannels({ cwd: dir, packagesDir: 'packages', packages: ['api'] })).toStrictEqual([]);
	expect(await detectStandardsChannels({ cwd: dir, packagesDir: 'packages', packages: ['web'] })).toStrictEqual(['react']);
	expect(await detectStandardsChannels({ cwd: dir, packagesDir: 'packages', packages: ['api', 'site'] })).toStrictEqual(['react', 'tanstack']);
	// unreadable manifests contribute nothing
	expect(await detectStandardsChannels({ cwd: dir, packagesDir: 'packages', packages: ['ghost'] })).toStrictEqual([]);
});

test('detectStandardsChannels falls back to the root package.json outside monorepo mode', async () => {
	const dir = setupMonorepo();

	writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'solo', dependencies: { react: '^19.0.0' } }));

	expect(await detectStandardsChannels({ cwd: dir, packagesDir: 'packages', packages: [] })).toStrictEqual(['react']);
});

test('detectStandardsChannels returns nothing when the root fallback manifest is absent', async () => {
	const dir = setupMonorepo();

	expect(await detectStandardsChannels({ cwd: dir, packagesDir: 'packages', packages: [] })).toStrictEqual([]);
});

test('detectStandardsChannels detects signals in devDependencies and peerDependencies', async () => {
	const dir = setupMonorepo();

	writePackage({ dir: join(dir, 'packages/web'), name: '@acme/web', devDeps: { react: '^19.0.0' } });
	writePackage({ dir: join(dir, 'packages/api'), name: '@acme/api', peerDeps: { '@tanstack/react-start': '^1.0.0' } });

	// devDependencies count
	expect(await detectStandardsChannels({ cwd: dir, packagesDir: 'packages', packages: ['web'] })).toStrictEqual(['react']);
	// peerDependencies count
	expect(await detectStandardsChannels({ cwd: dir, packagesDir: 'packages', packages: ['api'] })).toStrictEqual(['tanstack']);
});

test('detectStandardsChannels activates a channel from any of its signal packages', async () => {
	const dir = setupMonorepo();

	writePackage({ dir: join(dir, 'packages/web'), name: '@acme/web', deps: { 'react-dom': '^19.0.0' } });
	writePackage({ dir: join(dir, 'packages/api'), name: '@acme/api', deps: { '@tanstack/start': '^1.0.0' } });

	expect(await detectStandardsChannels({ cwd: dir, packagesDir: 'packages', packages: ['web'] })).toStrictEqual(['react']);
	expect(await detectStandardsChannels({ cwd: dir, packagesDir: 'packages', packages: ['api'] })).toStrictEqual(['tanstack']);
});

test('detectStandardsChannels ignores a package whose signal is not a dependency name', async () => {
	const dir = setupMonorepo();

	writePackage({ dir: join(dir, 'packages/web'), name: 'react', deps: { '@acme/react-utils': '^1.0.0' } });

	expect(await detectStandardsChannels({ cwd: dir, packagesDir: 'packages', packages: ['web'] })).toStrictEqual([]);
});

test('detectStandardsChannels skips unparseable manifests without suppressing their siblings', async () => {
	const dir = setupMonorepo();

	writeRawManifest({ dir: join(dir, 'packages/broken'), contents: '{ "dependencies": { "react"' });
	writeRawManifest({ dir: join(dir, 'packages/mistyped'), contents: JSON.stringify({ name: '@acme/mistyped', dependencies: { react: 19 } }) });
	writePackage({ dir: join(dir, 'packages/web'), name: '@acme/web', deps: { react: '^19.0.0' } });

	// malformed JSON contributes nothing
	expect(await detectStandardsChannels({ cwd: dir, packagesDir: 'packages', packages: ['broken'] })).toStrictEqual([]);
	// a manifest failing the schema contributes nothing
	expect(await detectStandardsChannels({ cwd: dir, packagesDir: 'packages', packages: ['mistyped'] })).toStrictEqual([]);
	// readable siblings still contribute their channels
	expect(await detectStandardsChannels({ cwd: dir, packagesDir: 'packages', packages: ['broken', 'mistyped', 'web'] })).toStrictEqual(['react']);
});

test('detectStandardsChannels resolves scoped manifests under a custom packagesDir', async () => {
	const dir = setupMonorepo();

	writePackage({ dir: join(dir, 'apps/web'), name: '@acme/web', deps: { react: '^19.0.0' } });

	expect(await detectStandardsChannels({ cwd: dir, packagesDir: 'apps', packages: ['web'] })).toStrictEqual(['react']);
	// the default dir holds a different web package with no react dep
	expect(await detectStandardsChannels({ cwd: dir, packagesDir: 'packages', packages: ['web'] })).toStrictEqual([]);
});

test('pipeline injects channel docs for react packages and announces the detection', async () => {
	const dir = setupMonorepo({ plan: '---\npackages:\n  - web\n---\n# Plan: web feature\n' });

	writePackage({ dir: join(dir, 'packages/web/src'), name: 'ignored', deps: {} });
	writePackage({ dir: join(dir, 'packages/web'), name: '@acme/web', deps: { preact: '^10.0.0' } });
	writeFileSync(join(dir, 'packages/web/src/index.js'), 'export const one = 1;\n');

	const prompts: Record<string, string> = {};
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, systemPrompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			// Standards ride the system prompt — capture both halves of the invocation.
			prompts[role] = `${systemPrompt ?? ''}\n${prompt}`;

			if (role === 'write-tests') {
				writeFileSync(join(dir, 'packages/web/src/feature.unit.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'packages/web/src/feature.unit.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			writeSource({ dir: dir, path: 'packages/web/src/feature.js', source: 'export const feature = () => 2;\n' });

			return { text: report({ changedFiles: [{ path: 'packages/web/src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	const progressLines: string[] = [];
	const result = await runImplementPipeline({
		cwd: dir,
		planPath: 'plan.md',
		driver,
		config: await loadConfig({ cwd: dir }),
		onProgress: (message) => progressLines.push(message),
	});

	expect(result.ok).toBe(true);
	// channel announcement:\n${progressLines.filter((line) =>
	// line.includes('standards')).join('\n')}
	expect(progressLines.some((line) => line.includes('standards channels: base + react (detected from package dependencies)'))).toBeTruthy();
	// test writer got the react channel doc
	expect(prompts['write-tests']?.includes('tests/unit-testing-react-components')).toBeTruthy();
	// executor got react architecture
	expect(prompts.implement?.includes('code/architecture/react')).toBeTruthy();
	// tanstack channel stays out without the dependency
	expect(prompts.implement?.includes('tanstack-start')).toBeFalsy();
});

test('standardsChannels config replaces detection', async () => {
	const dir = setupMonorepo();

	// api has no react dep — but config forces the channel on.
	const raw = JSON.parse((await import('node:fs')).readFileSync(join(dir, 'lightsout.config.json'), 'utf8'));

	writeFileSync(join(dir, 'lightsout.config.json'), JSON.stringify({ ...raw, 'standards-channels': ['react'] }));

	const prompts: Record<string, string> = {};
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, systemPrompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			// Standards ride the system prompt — capture both halves of the invocation.
			prompts[role] = `${systemPrompt ?? ''}\n${prompt}`;

			if (role === 'write-tests') {
				writeFileSync(join(dir, 'packages/api/src/feature.unit.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'packages/api/src/feature.unit.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			writeSource({ dir: dir, path: 'packages/api/src/feature.js', source: 'export const feature = () => 2;\n' });

			return { text: report({ changedFiles: [{ path: 'packages/api/src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	const progressLines: string[] = [];
	const result = await runImplementPipeline({
		cwd: dir,
		planPath: 'plan.md',
		driver,
		config: await loadConfig({ cwd: dir }),
		onProgress: (message) => progressLines.push(message),
	});

	expect(result.ok).toBe(true);
	expect(progressLines.some((line) => line.includes('standards channels: base + react (configured)'))).toBeTruthy();
	expect(prompts['write-tests']?.includes('tests/unit-testing-react-components')).toBeTruthy();
});
