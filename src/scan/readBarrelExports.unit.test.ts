import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readBarrelExports } from '@/scan';

const files = ['m/index.ts', 'm/foo.ts', 'm/bar.ts', 'm/baz.tsx', 'm/sub/index.ts'];

test('readBarrelExports parses named, type-only, aliased, and star re-exports with resolved targets', () => {
	const text = [
		"export { A, B } from './foo';",
		"export type { C } from './bar';",
		"export { D as E } from './baz';",
		"export * from './sub';",
		"export { X } from './missing';",
		"import { unrelated } from './foo';",
	].join('\n');

	const entries = readBarrelExports({ barrelPath: 'm/index.ts', text, files });

	const foo = entries.find((entry) => entry.specifier === './foo');
	assert.deepEqual(foo?.names, ['A', 'B'], 'named re-export lists both names');
	assert.equal(foo?.star, false);
	assert.equal(foo?.target, 'm/foo.ts', './foo probes to foo.ts');

	const bar = entries.find((entry) => entry.specifier === './bar');
	assert.deepEqual(bar?.names, ['C'], 'export type is a named re-export');
	assert.equal(bar?.target, 'm/bar.ts');

	const baz = entries.find((entry) => entry.specifier === './baz');
	assert.deepEqual(baz?.names, ['E'], 'aliased re-export exposes the alias, not the source name');
	assert.equal(baz?.target, 'm/baz.tsx', '.tsx probe');

	const sub = entries.find((entry) => entry.specifier === './sub');
	assert.equal(sub?.star, true, 'export * is a star entry');
	assert.deepEqual(sub?.names, [], 'star entries carry no names');
	assert.equal(sub?.target, 'm/sub/index.ts', '/index.ts probe');

	const missing = entries.find((entry) => entry.specifier === './missing');
	assert.equal(missing?.target, undefined, 'unresolvable specifier is still recorded with no target');

	assert.equal(entries.filter((entry) => entry.specifier === './foo').length, 1, 'a plain import is not a re-export');
});

test('readBarrelExports treats a namespace re-export as a star entry and leaves package specifiers unresolved', () => {
	const text = ["export * as tools from './sub';", "export { Z } from 'zod';"].join('\n');

	const entries = readBarrelExports({ barrelPath: 'm/index.ts', text, files });

	const namespaced = entries.find((entry) => entry.specifier === './sub');
	assert.equal(namespaced?.star, true, '`export * as ns` hides just as much as a bare `export *`');
	assert.deepEqual(namespaced?.names, [], 'the namespace alias is not a named entry');
	assert.equal(namespaced?.target, 'm/sub/index.ts');

	const external = entries.find((entry) => entry.specifier === 'zod');
	assert.deepEqual(external?.names, ['Z'], 'a package re-export still records its names');
	assert.equal(external?.target, undefined, 'a non-relative specifier resolves to no file in the repo');
});
