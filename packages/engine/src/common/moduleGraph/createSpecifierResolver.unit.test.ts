import { expect, test } from '@jest/globals';
import { createSpecifierResolver } from '#src/common/moduleGraph/createSpecifierResolver.ts';

const setupResolver = ({ files }: { files: string[] }) => ({ resolve: createSpecifierResolver({ files }) });

const relativeFiles = ['src/a/boundary.ts', 'src/a/deep/helper.tsx', 'src/shared/index.ts'];

test.each([
	{ case: 'a plain relative specifier', from: 'src/a/boundary.ts', specifier: './deep/helper', expected: 'src/a/deep/helper.tsx' },
	{ case: '../ traversal landing on a barrel via the /index probe', from: 'src/a/deep/helper.tsx', specifier: '../../shared', expected: 'src/shared/index.ts' },
	{ case: 'an explicit extension, stripped before matching', from: 'src/a/boundary.ts', specifier: './deep/helper.tsx', expected: 'src/a/deep/helper.tsx' },
	{ case: 'a relative specifier landing outside the universe', from: 'src/a/boundary.ts', specifier: './missing', expected: undefined },
])('createSpecifierResolver: $case resolves against the importing file', ({ from, specifier, expected }) => {
	const { resolve } = setupResolver({ files: relativeFiles });

	const resolved = resolve({ from, specifier });

	expect(resolved).toBe(expected);
});

const aliasFiles = ['src/widgets/Button.ts', 'src/x/dupe/thing.ts', 'src/y/dupe/thing.ts', 'src/shared/index.ts'];

test.each([
	{ case: 'an alias with a unique suffix', from: 'src/x/dupe/thing.ts', specifier: '@/widgets/Button', expected: 'src/widgets/Button.ts' },
	{ case: 'an alias landing on a barrel', from: 'src/x/dupe/thing.ts', specifier: '@/shared', expected: 'src/shared/index.ts' },
	{ case: 'a suffix two files share — ambiguous', from: 'src/widgets/Button.ts', specifier: '@x/lib/dupe/thing', expected: undefined },
	{ case: 'a single-segment external package, which never reaches a matchable tier', from: 'src/widgets/Button.ts', specifier: 'react', expected: undefined },
])('createSpecifierResolver: $case resolves by unique suffix', ({ from, specifier, expected }) => {
	const { resolve } = setupResolver({ files: aliasFiles });

	const resolved = resolve({ from, specifier });

	expect(resolved).toBe(expected);
});

const tieredFiles = ['src/widgets/Button.ts', 'src/deep/nested/leaf.ts', 'shared/index.ts'];

test.each([
	// '@scope/pkg/src/widgets/Button' misses at 'pkg/src/widgets/Button' and lands
	// at 'src/widgets/Button' — the whole stripped path, with nothing above it
	{
		case: 'a package specifier that matches only at its deepest tier',
		from: 'src/deep/nested/leaf.ts',
		specifier: '@scope/pkg/src/widgets/Button',
		expected: 'src/widgets/Button.ts',
	},
	{
		case: 'a top-level barrel matching as `<suffix>/index` with no folder above it',
		from: 'src/widgets/Button.ts',
		specifier: '@/shared',
		expected: 'shared/index.ts',
	},
	{ case: 'a scoped package with no deeper path, which runs out of tiers', from: 'src/widgets/Button.ts', specifier: '@scope/pkg', expected: undefined },
])('createSpecifierResolver: $case drops leading segments a tier at a time', ({ from, specifier, expected }) => {
	const { resolve } = setupResolver({ files: tieredFiles });

	const resolved = resolve({ from, specifier });

	expect(resolved).toBe(expected);
});

const extensionFiles = ['src/a/boundary.ts', 'src/a/helper.ts', 'src/a/legacy.mjs', 'src/a/view.jsx'];

test.each([
	// the NodeNext idiom: the specifier carries the extension TypeScript will emit
	{ case: 'a specifier naming the emitted .js file', specifier: './helper.js', expected: 'src/a/helper.ts' },
	{ case: 'a specifier naming the emitted .cjs file', specifier: './helper.cjs', expected: 'src/a/helper.ts' },
	{ case: 'a file whose own extension is .mjs', specifier: './legacy.mjs', expected: 'src/a/legacy.mjs' },
	{ case: 'a file whose own extension is .jsx', specifier: './view', expected: 'src/a/view.jsx' },
])('createSpecifierResolver: $case is stripped on both sides, so the source is still found', ({ specifier, expected }) => {
	const { resolve } = setupResolver({ files: extensionFiles });

	const resolved = resolve({ from: 'src/a/boundary.ts', specifier });

	expect(resolved).toBe(expected);
});

const packageImportsFiles = [
	'src/common/moduleGraph/collectImportEdges.ts',
	'src/contracts/index.ts',
	'src/widgets/Button.tsx',
	'tests/helpers/setupConsumerRepo.ts',
];

test.each([
	// the repo's own '#src/…' form: the '#src' segment is dropped a tier at a
	// time, and the extension the specifier must carry is stripped before matching
	{
		case: "a '#src/…' specifier carrying its file extension",
		specifier: '#src/common/moduleGraph/collectImportEdges.ts',
		expected: 'src/common/moduleGraph/collectImportEdges.ts',
	},
	{ case: 'a barrel named outright, without needing the /index probe', specifier: '#src/contracts/index.ts', expected: 'src/contracts/index.ts' },
	{ case: 'the same barrel named as its folder, landing via the probe', specifier: '#src/contracts', expected: 'src/contracts/index.ts' },
	{
		case: 'a second alias root, which is one more leading segment to drop',
		specifier: '#tests/helpers/setupConsumerRepo.ts',
		expected: 'tests/helpers/setupConsumerRepo.ts',
	},
])('createSpecifierResolver: $case resolves by suffix like any other alias', ({ specifier, expected }) => {
	const { resolve } = setupResolver({ files: packageImportsFiles });

	const resolved = resolve({ from: 'src/widgets/Button.tsx', specifier });

	expect(resolved).toBe(expected);
});
