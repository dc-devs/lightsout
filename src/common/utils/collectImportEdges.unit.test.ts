import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { collectImportEdges } from '@/common/utils/collectImportEdges';

// Runtime require, mirroring resolveConsumerTypescript: a static import would
// make esbuild inline the whole CJS compiler into the ESM test bundle, where
// its __filename probes crash.
const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');

const setupRepo = (files: Record<string, string>) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-graph-'));

	for (const [name, content] of Object.entries(files)) {
		mkdirSync(join(dir, dirname(name)), { recursive: true });
		writeFileSync(join(dir, name), content);
	}

	return dir;
};

test('collectImportEdges: relative paths, barrel index targets, unique alias suffix; ambiguity and externals make no edge', async () => {
	const dir = setupRepo({
		'src/a/boundary.ts': `import { helper } from './deep/helper';\nimport { Button } from '@/widgets/Button';\nimport { useState } from 'react';\nexport const boundary = () => helper();\n`,
		'src/a/deep/helper.ts': `import { shared } from '../../shared';\nexport const helper = () => shared;\n`,
		'src/shared/index.ts': `export const shared = 1;\n`,
		'src/widgets/Button.ts': `export const Button = 1;\n`,
		// Two files both ending in dupe/thing — an '@/dupe/thing' import would be ambiguous.
		'src/x/dupe/thing.ts': `export const one = 1;\n`,
		'src/y/dupe/thing.ts': `import { z } from '@x/lib/dupe/thing';\nexport const two = 2;\n`,
	});
	const files = ['src/a/boundary.ts', 'src/a/deep/helper.ts', 'src/shared/index.ts', 'src/widgets/Button.ts', 'src/x/dupe/thing.ts', 'src/y/dupe/thing.ts'];

	const edges = await collectImportEdges({ cwd: dir, files, compiler: ts });
	const asPairs = edges.map((edge) => `${edge.from} -> ${edge.to}`).sort();

	assert.deepEqual(asPairs, [
		'src/a/boundary.ts -> src/a/deep/helper.ts', // relative
		'src/a/boundary.ts -> src/widgets/Button.ts', // alias, unique suffix
		'src/a/deep/helper.ts -> src/shared/index.ts', // relative ../.. resolving to /index barrel
		// NOT: react (external, single segment), NOT: '@x/lib/dupe/thing' (suffix matches two changed files — ambiguous)
	]);
});

test('collectImportEdges: an alias resolving to a barrel, a repeated specifier, a self-import, and a file that is not on disk', async () => {
	const dir = setupRepo({
		'src/a/boundary.ts': `import { shared } from '@/shared';\nimport { one } from './helper';\nimport { two } from './helper';\nimport { self } from './boundary';\nexport const boundary = () => 1;\n`,
		'src/a/helper.ts': `export const one = 1;\nexport const two = 2;\n`,
		'src/shared/index.ts': `export const shared = 1;\n`,
	});
	// 'src/a/ghost.ts' is listed as changed but was never written — the read fails and the file contributes nothing.
	const files = ['src/a/boundary.ts', 'src/a/helper.ts', 'src/shared/index.ts', 'src/a/ghost.ts'];

	const edges = await collectImportEdges({ cwd: dir, files, compiler: ts });
	const asPairs = edges.map((edge) => `${edge.from} -> ${edge.to}`).sort();

	assert.deepEqual(asPairs, [
		'src/a/boundary.ts -> src/a/helper.ts', // imported twice, edged once
		'src/a/boundary.ts -> src/shared/index.ts', // alias suffix landing on a barrel
		// NOT: a self-edge from './boundary', NOT: anything from the unreadable src/a/ghost.ts
	]);
});
