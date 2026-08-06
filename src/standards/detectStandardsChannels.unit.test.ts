import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import type { Driver } from '@/drivers';
import { detectStandardsChannels, readStandards } from '@/standards';
import { loadConfig } from '@/common/utils/loadConfig';
import { runImplementPipeline } from '@/pipeline';
import { report } from '@tests/helpers/report';
import { roleOf } from '@tests/helpers/roleOf';
import { setupMonorepo } from '@tests/helpers/setupMonorepo';

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

test('bundled tokens expand to base docs plus active channels only', async () => {
	const base = await readStandards({ cwd: '/nonexistent', paths: ['lightsout:test-defaults'] });
	const withReact = await readStandards({ cwd: '/nonexistent', paths: ['lightsout:test-defaults'], channels: ['react'] });

	// base doc present
	expect(base?.includes('standards/tests/unit/jest/unit-testing.md')).toBeTruthy();
	// react doc absent without the channel
	expect(base?.includes('unit-testing-react-components.md')).toBeFalsy();
	// react doc present with the channel
	expect(withReact?.includes('unit-testing-react-components.md')).toBeTruthy();
	// base docs precede channel docs
	expect((withReact?.indexOf('unit-testing.md') ?? 0) < (withReact?.indexOf('unit-testing-react-components.md') ?? 0)).toBeTruthy();
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

			// Standards ride the system prompt — capture both halves of the invocation.
			prompts[role] = `${systemPrompt ?? ''}\n${prompt}`;

			if (role === 'write-tests') {
				writeFileSync(join(dir, 'packages/web/src/feature.unit.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'packages/web/src/feature.unit.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			writeFileSync(join(dir, 'packages/web/src/feature.js'), 'export const feature = () => 2;\n');

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
	expect(prompts['write-tests']?.includes('unit-testing-react-components.md')).toBeTruthy();
	// executor got react architecture
	expect(prompts['implement']?.includes('standards/code/architecture/react/architecture-decisions.md')).toBeTruthy();
	// tanstack channel stays out without the dependency
	expect(prompts['implement']?.includes('tanstack-start')).toBeFalsy();
});

test('standardsChannels config replaces detection', async () => {
	const dir = setupMonorepo();

	// api has no react dep — but config forces the channel on.
	const raw = JSON.parse((await import('node:fs')).readFileSync(join(dir, 'lightsout.config.json'), 'utf8'));

	writeFileSync(join(dir, 'lightsout.config.json'), JSON.stringify({ ...raw, standardsChannels: ['react'] }));

	const prompts: Record<string, string> = {};
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, systemPrompt }) => {
			const role = roleOf(prompt);

			// Standards ride the system prompt — capture both halves of the invocation.
			prompts[role] = `${systemPrompt ?? ''}\n${prompt}`;

			if (role === 'write-tests') {
				writeFileSync(join(dir, 'packages/api/src/feature.unit.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'packages/api/src/feature.unit.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			writeFileSync(join(dir, 'packages/api/src/feature.js'), 'export const feature = () => 2;\n');

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
	expect(prompts['write-tests']?.includes('unit-testing-react-components.md')).toBeTruthy();
});
