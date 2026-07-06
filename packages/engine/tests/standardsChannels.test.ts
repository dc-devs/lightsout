import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Driver } from '@lightsout/drivers';
import { detectStandardsChannels, readStandards } from '../src/standards';
import { loadConfig, runImplementPipeline } from '../src/index';
import { report } from './helpers/report';
import { roleOf } from './helpers/roleOf';
import { setupMonorepo } from './helpers/setupMonorepo';

const writePackage = ({ dir, name, deps }: { dir: string; name: string; deps?: Record<string, string> }) => {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, ...(deps ? { dependencies: deps } : {}) }));
};

test('detectStandardsChannels reads scoped package dependencies', async () => {
	const dir = setupMonorepo();

	writePackage({ dir: join(dir, 'packages/web'), name: '@acme/web', deps: { preact: '^10.0.0' } });
	writePackage({ dir: join(dir, 'packages/site'), name: '@acme/site', deps: { react: '^19.0.0', '@tanstack/react-start': '^1.0.0' } });

	assert.deepEqual(await detectStandardsChannels({ cwd: dir, packagesDir: 'packages', packages: ['api'] }), []);
	assert.deepEqual(await detectStandardsChannels({ cwd: dir, packagesDir: 'packages', packages: ['web'] }), ['react']);
	assert.deepEqual(await detectStandardsChannels({ cwd: dir, packagesDir: 'packages', packages: ['api', 'site'] }), ['react', 'tanstack']);
	assert.deepEqual(await detectStandardsChannels({ cwd: dir, packagesDir: 'packages', packages: ['ghost'] }), [], 'unreadable manifests contribute nothing');
});

test('detectStandardsChannels falls back to the root package.json outside monorepo mode', async () => {
	const dir = setupMonorepo();

	writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'solo', dependencies: { react: '^19.0.0' } }));

	assert.deepEqual(await detectStandardsChannels({ cwd: dir, packagesDir: 'packages', packages: [] }), ['react']);
});

test('bundled tokens expand to base docs plus active channels only', async () => {
	const base = await readStandards({ cwd: '/nonexistent', paths: ['lightsout:test-defaults'] });
	const withReact = await readStandards({ cwd: '/nonexistent', paths: ['lightsout:test-defaults'], channels: ['react'] });

	assert.ok(base?.includes('standards/tests/unit/jest/unit-testing.md'), 'base doc present');
	assert.ok(!base?.includes('unit-testing-react-components.md'), 'react doc absent without the channel');
	assert.ok(withReact?.includes('unit-testing-react-components.md'), 'react doc present with the channel');
	assert.ok(
		(withReact?.indexOf('unit-testing.md') ?? 0) < (withReact?.indexOf('unit-testing-react-components.md') ?? 0),
		'base docs precede channel docs',
	);
});

test('pipeline injects channel docs for react packages and announces the detection', async () => {
	const dir = setupMonorepo({ plan: '---\npackages:\n  - web\n---\n# Plan: web feature\n' });

	writePackage({ dir: join(dir, 'packages/web/src'), name: 'ignored', deps: {} });
	writePackage({ dir: join(dir, 'packages/web'), name: '@acme/web', deps: { preact: '^10.0.0' } });
	writeFileSync(join(dir, 'packages/web/src/index.js'), 'export const one = 1;\n');

	const prompts: Record<string, string> = {};
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			prompts[role] = prompt;

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

	assert.equal(result.ok, true, result.error);
	assert.ok(
		progressLines.some((line) => line.includes('standards channels: base + react (detected from package dependencies)')),
		`channel announcement:\n${progressLines.filter((line) => line.includes('standards')).join('\n')}`,
	);
	assert.ok(prompts['write-tests']?.includes('unit-testing-react-components.md'), 'test writer got the react channel doc');
	assert.ok(prompts['implement']?.includes('standards/code/architecture/react/architecture-decisions.md'), 'executor got react architecture');
	assert.ok(!prompts['implement']?.includes('tanstack-start'), 'tanstack channel stays out without the dependency');
});

test('standardsChannels config replaces detection', async () => {
	const dir = setupMonorepo();

	// api has no react dep — but config forces the channel on.
	const raw = JSON.parse((await import('node:fs')).readFileSync(join(dir, 'lightsout.config.json'), 'utf8'));

	writeFileSync(join(dir, 'lightsout.config.json'), JSON.stringify({ ...raw, standardsChannels: ['react'] }));

	const prompts: Record<string, string> = {};
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			prompts[role] = prompt;

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

	assert.equal(result.ok, true, result.error);
	assert.ok(progressLines.some((line) => line.includes('standards channels: base + react (configured)')));
	assert.ok(prompts['write-tests']?.includes('unit-testing-react-components.md'));
});
