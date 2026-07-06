import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { mapFolderModules } from '../src/scan/mapFolderModules';

const setup = (files: Record<string, string>) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-modules-'));

	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, rel)), { recursive: true });
		writeFileSync(join(dir, rel), content);
	}

	return dir;
};

test('mapFolderModules classifies by the barrel-omission test, skipping common/ and src roots', async () => {
	const files = {
		// module: barrel omits internal.ts
		'src/feat/index.ts': "export { feat } from './feat';\n",
		'src/feat/feat.ts': 'export const feat = 1;\n',
		'src/feat/internal.ts': 'export const internal = 2;\n',
		// domainFolder: barrel re-exports every file
		'src/fmt/index.ts': "export { a } from './a';\nexport { b } from './b';\n",
		'src/fmt/a.ts': 'export const a = 1;\n',
		'src/fmt/b.ts': 'export const b = 2;\n',
		// under a common/ segment → never a module
		'src/feat/common/utils/index.ts': "export { helper } from './helper';\n",
		'src/feat/common/utils/helper.ts': 'export const helper = 1;\n',
		// package/repo src root barrel → a package API, not a module
		'src/index.ts': "export { feat } from './feat';\n",
		// folder that OWNS a common/ subfolder → module even though its barrel covers every direct file
		'src/box/index.ts': "export { box } from './box';\n",
		'src/box/box.ts': 'export const box = 1;\n',
		'src/box/common/types/thing.ts': 'export type Thing = 1;\n',
	};
	const dir = setup(files);
	const map = await mapFolderModules({ cwd: dir, files: Object.keys(files) });

	assert.equal(map.get('src/feat')?.status, 'module', 'barrel omits internal.ts');
	assert.equal(map.get('src/fmt')?.status, 'domainFolder', 'barrel re-exports a and b — hides nothing');
	assert.equal(map.get('src/box')?.status, 'module', 'owning a common/ subfolder forces module status');
	assert.ok(!map.has('src/feat/common/utils'), 'folders under a common/ segment are never modules');
	assert.ok(!map.has('src'), 'a src-root barrel is excluded');

	assert.equal(map.get('src/feat')?.barrelPath, 'src/feat/index.ts');
	assert.deepEqual([...(map.get('src/fmt')?.exportedTargets ?? [])].sort(), ['src/fmt/a.ts', 'src/fmt/b.ts']);
});

test('mapFolderModules defers nested-module chains to domainFolder (safe no-boundary degradation)', async () => {
	const files = {
		// parent whose only non-index descendants live inside a nested module
		'src/group/index.ts': "export { child } from './child';\n",
		'src/group/child/index.ts': "export { child } from './child';\n",
		'src/group/child/child.ts': 'export const child = 1;\n',
		'src/group/child/hidden.ts': 'export const hidden = 2;\n',
	};
	const dir = setup(files);
	const map = await mapFolderModules({ cwd: dir, files: Object.keys(files) });

	assert.equal(map.get('src/group')?.status, 'domainFolder', 'nested-module subtree removed → parent omits nothing → deferred');
	assert.equal(map.get('src/group/child')?.status, 'module', 'the nested module still hides hidden.ts');
});
