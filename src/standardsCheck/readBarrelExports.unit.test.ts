import { expect, test } from '@jest/globals';
import { readBarrelExports } from '@/standardsCheck';

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
	// named re-export lists both names
	expect(foo?.names).toStrictEqual(['A', 'B']);
	expect(foo?.star).toBe(false);
	// ./foo probes to foo.ts
	expect(foo?.target).toBe('m/foo.ts');

	const bar = entries.find((entry) => entry.specifier === './bar');
	// export type is a named re-export
	expect(bar?.names).toStrictEqual(['C']);
	expect(bar?.target).toBe('m/bar.ts');

	const baz = entries.find((entry) => entry.specifier === './baz');
	// aliased re-export exposes the alias, not the source name
	expect(baz?.names).toStrictEqual(['E']);
	// .tsx probe
	expect(baz?.target).toBe('m/baz.tsx');

	const sub = entries.find((entry) => entry.specifier === './sub');
	// export * is a star entry
	expect(sub?.star).toBe(true);
	// star entries carry no names
	expect(sub?.names).toStrictEqual([]);
	// /index.ts probe
	expect(sub?.target).toBe('m/sub/index.ts');

	const missing = entries.find((entry) => entry.specifier === './missing');
	// unresolvable specifier is still recorded with no target
	expect(missing?.target).toBe(undefined);

	// a plain import is not a re-export
	expect(entries.filter((entry) => entry.specifier === './foo').length).toBe(1);
});

test('readBarrelExports treats a namespace re-export as a star entry and leaves package specifiers unresolved', () => {
	const text = ["export * as tools from './sub';", "export { Z } from 'zod';"].join('\n');

	const entries = readBarrelExports({ barrelPath: 'm/index.ts', text, files });

	const namespaced = entries.find((entry) => entry.specifier === './sub');
	// `export * as ns` hides just as much as a bare `export *`
	expect(namespaced?.star).toBe(true);
	// the namespace alias is not a named entry
	expect(namespaced?.names).toStrictEqual([]);
	expect(namespaced?.target).toBe('m/sub/index.ts');

	const external = entries.find((entry) => entry.specifier === 'zod');
	// a package re-export still records its names
	expect(external?.names).toStrictEqual(['Z']);
	// a non-relative specifier resolves to no file in the repo
	expect(external?.target).toBe(undefined);
});
