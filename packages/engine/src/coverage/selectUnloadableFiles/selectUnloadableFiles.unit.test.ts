import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { resolveConsumerTypescript } from '#src/common/workspace/resolveConsumerTypescript.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { selectUnloadableFiles } from '#src/coverage/selectUnloadableFiles/selectUnloadableFiles.ts';
import { linkTypescript } from '#tests/helpers/linkTypescript.ts';

// The reader genuinely requires the consumer's Jest config, so every case
// plants a real one on disk rather than stubbing the read.
const setupRepo = ({ files }: { files: Record<string, string> }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-unloadable-'));

	for (const [name, content] of Object.entries(files)) {
		mkdirSync(join(cwd, dirname(name)), { recursive: true });
		writeFileSync(join(cwd, name), content);
	}

	linkTypescript({ dir: cwd });

	const compiler = resolveConsumerTypescript({ cwd });

	if (compiler === undefined) {
		throw new Error('the linked typescript must resolve');
	}

	return { cwd, compiler };
};

const jestConfig = ({ settings }: { settings: Record<string, unknown> }) => `module.exports = ${JSON.stringify(settings)};\n`;

const commandConfig = ({ command }: { command: string }): LightsoutConfig => ({ gates: { check: 'true', test: 'true', 'test-coverage': command } });

/** Root mode, with the coverage command naming its own config — the shape every package in this workspace uses. */
const rootConfig = commandConfig({ command: 'jest -c jest.config.cjs --coverage' });

const monorepoConfig: LightsoutConfig = {
	gates: { check: 'true', test: 'true', 'test-coverage': false },
	'package-gates': { check: 'true {package}', test: 'true {package}', 'test-coverage': 'pnpm --filter {package} run test:coverage' },
};

/** The shape of the engine's own CLI entry: a call awaited at module scope. */
const awaiting = "import { main } from './cli';\n\nawait main();\n";

const plain = 'export const value = 1;\n';

/** Plant a root jest.config.cjs holding `settings` over `sources`, then split them. */
const splitRoot = async ({ settings, sources }: { settings: Record<string, unknown>; sources: Record<string, string> }) => {
	const { cwd, compiler } = setupRepo({ files: { 'jest.config.cjs': jestConfig({ settings }), ...sources } });

	return selectUnloadableFiles({ cwd, config: rootConfig, files: Object.keys(sources), compiler });
};

test('selectUnloadableFiles: a module-scope await is loadable when extensionsToTreatAsEsm names the extension', async () => {
	const { loadable, unloadable } = await splitRoot({ settings: { extensionsToTreatAsEsm: ['.ts'] }, sources: { 'src/main.ts': awaiting } });

	expect(loadable).toStrictEqual(['src/main.ts']);
	expect(unloadable).toStrictEqual([]);
});

test('selectUnloadableFiles: the same file under a CommonJS configuration stays unloadable', async () => {
	const { loadable, unloadable } = await splitRoot({ settings: {}, sources: { 'src/main.ts': awaiting } });

	expect(unloadable).toStrictEqual(['src/main.ts']);
	expect(loadable).toStrictEqual([]);
});

test('selectUnloadableFiles: .mjs is an ES module with no configuration key at all, while its .ts sibling is not', async () => {
	const { loadable, unloadable } = await splitRoot({ settings: {}, sources: { 'src/main.mjs': awaiting, 'src/main.ts': awaiting } });

	expect(loadable).toStrictEqual(['src/main.mjs']);
	expect(unloadable).toStrictEqual(['src/main.ts']);
});

test('selectUnloadableFiles: a "type": "module" manifest makes a .js file an ES module and leaves a .ts file CommonJS', async () => {
	const { cwd, compiler } = setupRepo({
		files: {
			'package.json': JSON.stringify({ name: 'consumer', type: 'module' }),
			'jest.config.cjs': jestConfig({ settings: {} }),
			'src/main.js': awaiting,
			'src/main.ts': awaiting,
		},
	});

	const { loadable, unloadable } = await selectUnloadableFiles({ cwd, config: rootConfig, files: ['src/main.js', 'src/main.ts'], compiler });

	expect(loadable).toStrictEqual(['src/main.js']);
	expect(unloadable).toStrictEqual(['src/main.ts']);
});

test('selectUnloadableFiles: the nearest manifest decides, so a nested CommonJS package inside a "type": "module" repo stays unloadable', async () => {
	const { cwd, compiler } = setupRepo({
		files: {
			'package.json': JSON.stringify({ name: 'consumer', type: 'module' }),
			'jest.config.cjs': jestConfig({ settings: {} }),
			'src/main.js': awaiting,
			'src/legacy/package.json': JSON.stringify({ name: 'legacy', type: 'commonjs' }),
			'src/legacy/main.js': awaiting,
		},
	});

	// reading only the scope root would call the nested file an ES module and
	// fail a run on a file no test could ever cover
	const { loadable, unloadable } = await selectUnloadableFiles({ cwd, config: rootConfig, files: ['src/main.js', 'src/legacy/main.js'], compiler });

	expect(loadable).toStrictEqual(['src/main.js']);
	expect(unloadable).toStrictEqual(['src/legacy/main.js']);
});

test('selectUnloadableFiles: a preset that sets extensionsToTreatAsEsm turns the file loadable', async () => {
	const { cwd, compiler } = setupRepo({
		files: {
			'jest.config.cjs': jestConfig({ settings: { preset: 'esm-preset' } }),
			'node_modules/esm-preset/package.json': JSON.stringify({ name: 'esm-preset', main: 'jest-preset.js' }),
			'node_modules/esm-preset/jest-preset.js': "module.exports = { extensionsToTreatAsEsm: ['.ts'] };\n",
			'src/main.ts': awaiting,
		},
	});

	// the canonical `ts-jest/presets/default-esm` shape: the key lives in the
	// preset module, never in the consumer's own config file
	const { loadable } = await selectUnloadableFiles({ cwd, config: rootConfig, files: ['src/main.ts'], compiler });

	expect(loadable).toStrictEqual(['src/main.ts']);
});

test('selectUnloadableFiles: a preset that cannot be resolved leaves the file unloadable rather than throwing', async () => {
	const { unloadable } = await splitRoot({ settings: { preset: 'no-such-esm-preset' }, sources: { 'src/main.ts': awaiting } });

	expect(unloadable).toStrictEqual(['src/main.ts']);
});

test('selectUnloadableFiles: an inline projects entry contributes its extensionsToTreatAsEsm', async () => {
	const { loadable } = await splitRoot({
		settings: { projects: [{ displayName: 'unit', extensionsToTreatAsEsm: ['.ts'] }] },
		sources: { 'src/main.ts': awaiting },
	});

	expect(loadable).toStrictEqual(['src/main.ts']);
});

test('selectUnloadableFiles: a projects array of path strings contributes nothing and leaves the file unloadable', async () => {
	const { unloadable } = await splitRoot({ settings: { projects: ['<rootDir>/packages/api'] }, sources: { 'src/main.ts': awaiting } });

	// following a path entry means locating and loading a second config file for
	// an answer whose absence is already the safe one
	expect(unloadable).toStrictEqual(['src/main.ts']);
});

test('selectUnloadableFiles: .cjs is never an ES module even when extensionsToTreatAsEsm lists it', async () => {
	const { unloadable } = await splitRoot({ settings: { extensionsToTreatAsEsm: ['.cjs'] }, sources: { 'src/main.cjs': awaiting } });

	expect(unloadable).toStrictEqual(['src/main.cjs']);
});

test('selectUnloadableFiles: a file with no module-scope await is loadable in either module mode', async () => {
	expect((await splitRoot({ settings: {}, sources: { 'src/a.ts': plain } })).loadable).toStrictEqual(['src/a.ts']);
	expect((await splitRoot({ settings: { extensionsToTreatAsEsm: ['.ts'] }, sources: { 'src/a.ts': plain } })).loadable).toStrictEqual(['src/a.ts']);
});

test('selectUnloadableFiles: without the consumer’s TypeScript every file is loadable and nothing is read', async () => {
	const { loadable, unloadable } = await selectUnloadableFiles({
		cwd: '/nowhere',
		config: rootConfig,
		files: ['src/main.ts'],
		compiler: undefined,
	});

	expect(loadable).toStrictEqual(['src/main.ts']);
	expect(unloadable).toStrictEqual([]);
});

test('selectUnloadableFiles: a file that cannot be read at all is loadable, leaving the caller’s own handling of it', async () => {
	const { cwd, compiler } = setupRepo({ files: { 'jest.config.cjs': jestConfig({ settings: {} }) } });

	const { loadable } = await selectUnloadableFiles({ cwd, config: rootConfig, files: ['src/gone.ts'], compiler });

	expect(loadable).toStrictEqual(['src/gone.ts']);
});

test('selectUnloadableFiles: no configuration at all leaves the file unloadable', async () => {
	const { cwd, compiler } = setupRepo({ files: { 'src/main.ts': awaiting } });

	const { unloadable } = await selectUnloadableFiles({ cwd, config: rootConfig, files: ['src/main.ts'], compiler });

	expect(unloadable).toStrictEqual(['src/main.ts']);
});

test('selectUnloadableFiles: a configuration the engine cannot require leaves the file unloadable', async () => {
	const { cwd, compiler } = setupRepo({
		files: {
			// a real jest.config.ts imports its preset — unresolvable here, so the require throws
			'jest.config.ts': [
				"import { createDefaultPreset } from 'ts-jest';",
				'',
				"export default { ...createDefaultPreset(), extensionsToTreatAsEsm: ['.ts'] };",
			].join('\n'),
			'src/main.ts': awaiting,
		},
	});
	const config = commandConfig({ command: 'jest -c jest.config.ts --coverage' });

	const { unloadable } = await selectUnloadableFiles({ cwd, config, files: ['src/main.ts'], compiler });

	expect(unloadable).toStrictEqual(['src/main.ts']);
});

test('selectUnloadableFiles: a configuration exporting a promise is not awaited, and its file stays unloadable', async () => {
	const { cwd, compiler } = setupRepo({
		files: { 'jest.config.cjs': "module.exports = Promise.resolve({ extensionsToTreatAsEsm: ['.ts'] });\n", 'src/main.ts': awaiting },
	});

	const { unloadable } = await selectUnloadableFiles({ cwd, config: rootConfig, files: ['src/main.ts'], compiler });

	expect(unloadable).toStrictEqual(['src/main.ts']);
});

test('selectUnloadableFiles: a file no coverage scope measures is unloadable', async () => {
	const { cwd, compiler } = setupRepo({ files: { 'jest.config.cjs': jestConfig({ settings: { extensionsToTreatAsEsm: ['.ts'] } }), 'src/main.ts': awaiting } });

	// monorepo mode owns nothing outside the packages dir, so no Jest
	// configuration governs this file and its module mode is undetermined
	const { unloadable } = await selectUnloadableFiles({ cwd, config: monorepoConfig, files: ['src/main.ts'], compiler });

	expect(unloadable).toStrictEqual(['src/main.ts']);
});

test('selectUnloadableFiles: in monorepo mode each package’s own configuration decides, splitting identical files opposite ways', async () => {
	const packageManifest = ({ name }: { name: string }) => JSON.stringify({ name, scripts: { 'test:coverage': 'jest -c jest.config.cjs --coverage' } });
	const { cwd, compiler } = setupRepo({
		files: {
			'packages/esm/package.json': packageManifest({ name: '@acme/esm' }),
			'packages/esm/jest.config.cjs': jestConfig({ settings: { extensionsToTreatAsEsm: ['.ts'] } }),
			'packages/esm/src/main.ts': awaiting,
			'packages/cjs/package.json': packageManifest({ name: '@acme/cjs' }),
			'packages/cjs/jest.config.cjs': jestConfig({ settings: {} }),
			'packages/cjs/src/main.ts': awaiting,
		},
	});

	const { loadable, unloadable } = await selectUnloadableFiles({
		cwd,
		config: monorepoConfig,
		files: ['packages/esm/src/main.ts', 'packages/cjs/src/main.ts'],
		compiler,
	});

	expect(loadable).toStrictEqual(['packages/esm/src/main.ts']);
	expect(unloadable).toStrictEqual(['packages/cjs/src/main.ts']);
});

test('selectUnloadableFiles: a configuration that is not a settings object at all leaves the file unloadable', async () => {
	const { cwd, compiler } = setupRepo({ files: { 'jest.config.cjs': 'module.exports = [];\n', 'src/main.ts': awaiting } });

	// a shape the engine does not recognise is one it must not reason from
	const { unloadable } = await selectUnloadableFiles({ cwd, config: rootConfig, files: ['src/main.ts'], compiler });

	expect(unloadable).toStrictEqual(['src/main.ts']);
});

test('selectUnloadableFiles: a preset that resolves only under its bare name still contributes its extensions', async () => {
	const { cwd, compiler } = setupRepo({
		files: {
			'jest.config.cjs': jestConfig({ settings: { preset: 'bare-preset' } }),
			// no jest-preset.js here, so the `<preset>/jest-preset` specifier Jest
			// tries first cannot resolve and the bare name is what answers
			'node_modules/bare-preset/package.json': JSON.stringify({ name: 'bare-preset', main: 'index.js' }),
			'node_modules/bare-preset/index.js': "module.exports = { extensionsToTreatAsEsm: ['.ts'] };\n",
			'src/main.ts': awaiting,
		},
	});

	const { loadable } = await selectUnloadableFiles({ cwd, config: rootConfig, files: ['src/main.ts'], compiler });

	expect(loadable).toStrictEqual(['src/main.ts']);
});

test('selectUnloadableFiles: a preset that is not a settings object contributes nothing and leaves the file unloadable', async () => {
	const { cwd, compiler } = setupRepo({
		files: {
			'jest.config.cjs': jestConfig({ settings: { preset: 'array-preset' } }),
			'node_modules/array-preset/package.json': JSON.stringify({ name: 'array-preset', main: 'jest-preset.js' }),
			'node_modules/array-preset/jest-preset.js': 'module.exports = [];\n',
			'src/main.ts': awaiting,
		},
	});

	const { unloadable } = await selectUnloadableFiles({ cwd, config: rootConfig, files: ['src/main.ts'], compiler });

	expect(unloadable).toStrictEqual(['src/main.ts']);
});

test('selectUnloadableFiles: an inline projects entry naming no extensionsToTreatAsEsm contributes nothing', async () => {
	const { unloadable } = await splitRoot({ settings: { projects: [{ displayName: 'unit' }] }, sources: { 'src/main.ts': awaiting } });

	expect(unloadable).toStrictEqual(['src/main.ts']);
});

test('selectUnloadableFiles: a manifest whose "type" is not a string declares none, so its .js file stays unloadable', async () => {
	const { cwd, compiler } = setupRepo({
		files: { 'package.json': JSON.stringify({ name: 'consumer', type: 5 }), 'jest.config.cjs': jestConfig({ settings: {} }), 'src/main.js': awaiting },
	});

	// reading a non-string as "module" would be the false ESM verdict that fails
	// a run on a file no test could ever cover
	const { unloadable } = await selectUnloadableFiles({ cwd, config: rootConfig, files: ['src/main.js'], compiler });

	expect(unloadable).toStrictEqual(['src/main.js']);
});
