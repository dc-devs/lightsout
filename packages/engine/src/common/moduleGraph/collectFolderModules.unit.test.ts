import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { collectFolderModules } from '#src/common/moduleGraph/collectFolderModules.ts';

// Runtime require rather than a static import: the CJS TypeScript compiler
// probes __filename at load, so it has to be required at runtime rather than
// pulled into the module graph. ts-jest transpiles this file to CommonJS, where
// `require` is already the local resolver — `import.meta` does not exist there.
const ts = require('typescript') as typeof import('typescript');

const setupRepo = ({ files }: { files: Record<string, string> }) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-modules-'));

	for (const [name, content] of Object.entries(files)) {
		mkdirSync(join(dir, dirname(name)), { recursive: true });
		writeFileSync(join(dir, name), content);
	}

	return dir;
};

test('collectFolderModules: a barrel that hides a file marks a module; one that exports everything does not; src roots and common/ never do', async () => {
	const files = [
		'src/index.ts',
		'src/feature/index.ts',
		'src/feature/feature.ts',
		'src/feature/helper.ts',
		'src/domain/index.ts',
		'src/domain/one.ts',
		'src/common/utils/index.ts',
		'src/common/utils/util.ts',
	];
	const cwd = setupRepo({
		files: {
			// src root barrel — excluded however it looks
			'src/index.ts': "export { feature } from './feature';",
			// hides helper.ts → module
			'src/feature/index.ts': "export { feature } from './feature';",
			'src/feature/feature.ts': 'export const feature = 1;',
			'src/feature/helper.ts': 'export const helper = 1;',
			// exports its only file → domain folder, not a module
			'src/domain/index.ts': "export { one } from './one';",
			'src/domain/one.ts': 'export const one = 1;',
			// under a common/ segment — excluded however it looks
			'src/common/utils/index.ts': '',
			'src/common/utils/util.ts': 'export const util = 1;',
		},
	});

	const modules = await collectFolderModules({ cwd, files, compiler: ts });

	expect([...modules.keys()]).toStrictEqual(['src/feature']);
	expect(modules.get('src/feature')?.barrelPath).toBe('src/feature/index.ts');
	expect([...(modules.get('src/feature')?.exportedTargets ?? [])]).toStrictEqual(['src/feature/feature.ts']);
});

test('collectFolderModules: an own common/ makes a module, nested-module files are removed before the omission test, and an unreadable surface is silence', async () => {
	const files = [
		'src/withCommon/index.ts',
		'src/withCommon/main.ts',
		'src/withCommon/common/types/Config.ts',
		'src/parent/index.ts',
		'src/parent/parent.ts',
		'src/parent/child/index.ts',
		'src/parent/child/child.ts',
		'src/parent/child/hidden.ts',
		'src/broken/index.ts',
		'src/broken/main.ts',
		'src/broken/hidden.ts',
		'src/ghostbarrel/index.ts',
		'src/ghostbarrel/hidden.ts',
	];
	const cwd = setupRepo({
		files: {
			// exports every own file, but its own common/ still marks the boundary
			'src/withCommon/index.ts': "export { main } from './main';",
			'src/withCommon/main.ts': 'export const main = 1;',
			'src/withCommon/common/types/Config.ts': 'export interface Config { name: string }',
			// exports its only own file once the nested module's files are removed → not a module
			'src/parent/index.ts': "export { parent } from './parent';",
			'src/parent/parent.ts': 'export const parent = 1;',
			// the nested module hides its own file → module
			'src/parent/child/index.ts': "export { child } from './child';",
			'src/parent/child/child.ts': 'export const child = 1;',
			'src/parent/child/hidden.ts': 'export const hidden = 1;',
			// a specifier that resolves nowhere leaves the surface unreadable → silence
			'src/broken/index.ts': "export { ghost } from './ghost';",
			'src/broken/main.ts': 'export const main = 1;',
			'src/broken/hidden.ts': 'export const hidden = 1;',
			// the ghostbarrel barrel is listed but never written to disk — an
			// unreadable barrel is the same silence, not an invented boundary
			'src/ghostbarrel/hidden.ts': 'export const hidden = 1;',
		},
	});

	const modules = await collectFolderModules({ cwd, files, compiler: ts });

	expect([...modules.keys()].sort()).toStrictEqual(['src/parent/child', 'src/withCommon']);
});

test('collectFolderModules: an index.tsx barrel counts as one, and a file that is not TypeScript is never the omission that marks a module', async () => {
	const files = ['src/panel/index.tsx', 'src/panel/Panel.tsx', 'src/panel/panel.css', 'src/tray/index.tsx', 'src/tray/Tray.tsx', 'src/tray/useTray.ts'];
	const cwd = setupRepo({
		files: {
			// exports its only TypeScript file; the stylesheet beside it is not an omission
			'src/panel/index.tsx': "export { Panel } from './Panel';",
			'src/panel/Panel.tsx': 'export const Panel = () => null;',
			'src/panel/panel.css': '.panel { color: red; }',
			// hides useTray.ts → a module, and its barrel is a .tsx one
			'src/tray/index.tsx': "export { Tray } from './Tray';",
			'src/tray/Tray.tsx': 'export const Tray = () => null;',
			'src/tray/useTray.ts': 'export const useTray = () => 1;',
		},
	});

	const modules = await collectFolderModules({ cwd, files, compiler: ts });

	expect([...modules.keys()]).toStrictEqual(['src/tray']);
	expect(modules.get('src/tray')?.barrelPath).toBe('src/tray/index.tsx');
});

test('collectFolderModules: a framework-mandated folder is a module however its barrel looks, and a folder the callback declines still answers the omission test alone', async () => {
	const files = [
		'src/screens/RunsIndex/index.ts',
		'src/screens/RunsIndex/RunsIndex.ts',
		'src/screens/plain/index.ts',
		'src/screens/plain/plain.ts',
		'src/screens/hides/index.ts',
		'src/screens/hides/hides.ts',
		'src/screens/hides/helper.ts',
	];
	const cwd = setupRepo({
		files: {
			// exports its only file, so the omission test says no — the mandate says yes anyway
			'src/screens/RunsIndex/index.ts': "export { RunsIndex } from './RunsIndex';",
			'src/screens/RunsIndex/RunsIndex.ts': 'export const RunsIndex = 1;',
			// exports its only file and the callback declines it → not a module
			'src/screens/plain/index.ts': "export { plain } from './plain';",
			'src/screens/plain/plain.ts': 'export const plain = 1;',
			// declined too, but hides helper.ts → the omission test marks it alone
			'src/screens/hides/index.ts': "export { hides } from './hides';",
			'src/screens/hides/hides.ts': 'export const hides = 1;',
			'src/screens/hides/helper.ts': 'export const helper = 1;',
		},
	});

	const modules = await collectFolderModules({ cwd, files, compiler: ts, isMandatedModule: ({ folder }) => folder === 'src/screens/RunsIndex' });

	expect([...modules.keys()].sort()).toStrictEqual(['src/screens/RunsIndex', 'src/screens/hides']);
	expect(modules.get('src/screens/RunsIndex')).toStrictEqual({
		barrelPath: 'src/screens/RunsIndex/index.ts',
		exportedTargets: new Set(['src/screens/RunsIndex/RunsIndex.ts']),
	});
});

test('collectFolderModules: a mandate cannot invent a boundary from a barrel whose surface could not be read', async () => {
	const files = ['src/mandated/index.ts', 'src/mandated/main.ts'];
	const cwd = setupRepo({
		files: {
			// a specifier that resolves nowhere leaves the surface incomplete — silence outranks the mandate
			'src/mandated/index.ts': "export { ghost } from './ghost';",
			'src/mandated/main.ts': 'export const main = 1;',
		},
	});

	const modules = await collectFolderModules({ cwd, files, compiler: ts, isMandatedModule: () => true });

	expect([...modules.keys()]).toStrictEqual([]);
});

test('collectFolderModules: a folder whose index file the framework loads is no module, and the same tree without that answer is', async () => {
	const files = ['src/routes/index.tsx', 'src/routes/__root.tsx', 'src/routes/runs.tsx'];
	const cwd = setupRepo({
		files: {
			// a route file, not a barrel — read as one it publishes nothing while
			// hiding every route beside it
			'src/routes/index.tsx': "export const Route = { path: '/' };",
			'src/routes/__root.tsx': "export const Route = { path: '' };",
			'src/routes/runs.tsx': "export const Route = { path: '/runs' };",
		},
	});

	const loaded = await collectFolderModules({ cwd, files, compiler: ts, isFrameworkLoaded: ({ path }) => path.startsWith('src/routes/') });
	const unanswered = await collectFolderModules({ cwd, files, compiler: ts });

	expect([...loaded.keys()]).toStrictEqual([]);
	expect([...unanswered.keys()]).toStrictEqual(['src/routes']);
});
