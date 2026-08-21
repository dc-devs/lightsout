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
