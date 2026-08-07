import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from '@jest/globals';
import { listSourceFiles } from '@/common/utils/listSourceFiles';

const setupRepo = (files: string[]) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-listsrc-'));

	for (const name of files) {
		mkdirSync(join(cwd, dirname(name)), { recursive: true });
		writeFileSync(join(cwd, name), 'export const one = 1;\n');
	}

	return { cwd };
};

test('listSourceFiles: every JS/TS flavor is listed repo-relative and sorted, with test files included', async () => {
	const { cwd } = setupRepo([
		'src/b/second.tsx',
		'src/a/first.ts',
		'src/a/first.unit.test.ts',
		'src/legacy.cjs',
		'src/esm.mjs',
		'src/types.mts',
		'src/old.cts',
		'src/widget.jsx',
		'src/util.js',
	]);

	const files = await listSourceFiles({ cwd });

	expect(files).toStrictEqual([
		'src/a/first.ts',
		'src/a/first.unit.test.ts',
		'src/b/second.tsx',
		'src/esm.mjs',
		'src/legacy.cjs',
		'src/old.cts',
		'src/types.mts',
		'src/util.js',
		'src/widget.jsx',
	]);
});

test('listSourceFiles: dot entries, dependency and build dirs, declaration files, and non-source extensions are skipped', async () => {
	const { cwd } = setupRepo([
		'src/keep.ts',
		'src/types.d.ts',
		'src/data.json',
		'src/styles.css',
		'README.md',
		'.hidden/secret.ts',
		'src/.cache/tmp.ts',
		'node_modules/pkg/index.js',
		'dist/bundle.js',
		'build/out.js',
		'coverage/lcov.js',
		'out/thing.js',
	]);

	const files = await listSourceFiles({ cwd });

	expect(files).toStrictEqual(['src/keep.ts']);
});

test('listSourceFiles: the exclude list drops matching paths, with or without a trailing slash', async () => {
	const { cwd } = setupRepo(['src/keep.ts', 'src/gen/client.ts', 'packages/api/generated/schema.ts']);

	const files = await listSourceFiles({ cwd, exclude: ['src/gen/', 'packages/api/generated'] });

	// a declared generated path is excluded whether or not the config spelled it
	// with a trailing slash
	expect(files).toStrictEqual(['src/keep.ts']);
});

test('listSourceFiles: an unreadable directory yields no files rather than throwing', async () => {
	const { cwd } = setupRepo([]);

	const files = await listSourceFiles({ cwd: join(cwd, 'not-there') });

	expect(files).toStrictEqual([]);
});
