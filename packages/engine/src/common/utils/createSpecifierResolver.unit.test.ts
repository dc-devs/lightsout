import { expect, test } from '@jest/globals';
import { createSpecifierResolver } from '#src/common/utils/createSpecifierResolver.ts';

test('createSpecifierResolver: relative specifiers resolve against the importing file, with index probing and extension stripping', () => {
	const resolve = createSpecifierResolver({
		files: ['src/a/boundary.ts', 'src/a/deep/helper.tsx', 'src/shared/index.ts'],
	});

	// plain relative
	expect(resolve({ from: 'src/a/boundary.ts', specifier: './deep/helper' })).toBe('src/a/deep/helper.tsx');
	// ../ traversal landing on a barrel via the /index probe
	expect(resolve({ from: 'src/a/deep/helper.tsx', specifier: '../../shared' })).toBe('src/shared/index.ts');
	// an explicit extension is stripped before matching
	expect(resolve({ from: 'src/a/boundary.ts', specifier: './deep/helper.tsx' })).toBe('src/a/deep/helper.tsx');
	// a relative specifier landing outside the universe resolves to nothing
	expect(resolve({ from: 'src/a/boundary.ts', specifier: './missing' })).toBe(undefined);
});

test('createSpecifierResolver: aliased specifiers resolve by unique suffix; ambiguity and externals resolve to nothing', () => {
	const resolve = createSpecifierResolver({
		files: ['src/widgets/Button.ts', 'src/x/dupe/thing.ts', 'src/y/dupe/thing.ts', 'src/shared/index.ts'],
	});

	// alias with a unique suffix
	expect(resolve({ from: 'src/x/dupe/thing.ts', specifier: '@/widgets/Button' })).toBe('src/widgets/Button.ts');
	// alias landing on a barrel
	expect(resolve({ from: 'src/x/dupe/thing.ts', specifier: '@/shared' })).toBe('src/shared/index.ts');
	// two files share the suffix — ambiguous, no resolution
	expect(resolve({ from: 'src/widgets/Button.ts', specifier: '@x/lib/dupe/thing' })).toBe(undefined);
	// a single-segment external package never reaches a matchable tier
	expect(resolve({ from: 'src/widgets/Button.ts', specifier: 'react' })).toBe(undefined);
});

test('createSpecifierResolver: a package specifier drops leading segments a tier at a time until one tier matches', () => {
	const resolve = createSpecifierResolver({
		files: ['src/widgets/Button.ts', 'src/deep/nested/leaf.ts', 'shared/index.ts'],
	});

	// '@scope/pkg/src/widgets/Button' misses at 'pkg/src/widgets/Button' and lands
	// at 'src/widgets/Button' — the whole stripped path, with nothing above it
	expect(resolve({ from: 'src/deep/nested/leaf.ts', specifier: '@scope/pkg/src/widgets/Button' })).toBe('src/widgets/Button.ts');
	// a top-level barrel matches as `<suffix>/index` with no folder above it either
	expect(resolve({ from: 'src/widgets/Button.ts', specifier: '@/shared' })).toBe('shared/index.ts');
	// a scoped package with no deeper path runs out of tiers before it can match
	expect(resolve({ from: 'src/widgets/Button.ts', specifier: '@scope/pkg' })).toBe(undefined);
});

test('createSpecifierResolver: the extension is stripped from both sides, so a specifier naming the emitted file still finds the source', () => {
	const resolve = createSpecifierResolver({
		files: ['src/a/boundary.ts', 'src/a/helper.ts', 'src/a/legacy.mjs', 'src/a/view.jsx'],
	});

	// the NodeNext idiom: the specifier carries the extension TypeScript will emit
	expect(resolve({ from: 'src/a/boundary.ts', specifier: './helper.js' })).toBe('src/a/helper.ts');
	expect(resolve({ from: 'src/a/boundary.ts', specifier: './helper.cjs' })).toBe('src/a/helper.ts');
	// a file whose own extension is .mjs or .jsx is stripped the same way
	expect(resolve({ from: 'src/a/boundary.ts', specifier: './legacy.mjs' })).toBe('src/a/legacy.mjs');
	expect(resolve({ from: 'src/a/boundary.ts', specifier: './view' })).toBe('src/a/view.jsx');
});

test('createSpecifierResolver: a package-imports specifier carrying its file extension resolves by suffix like any other alias', () => {
	const resolve = createSpecifierResolver({
		files: ['src/common/utils/collectImportEdges.ts', 'src/contracts/index.ts', 'src/widgets/Button.tsx', 'tests/helpers/setupConsumerRepo.ts'],
	});

	// the repo's own '#src/…' form: the '#src' segment is dropped a tier at a
	// time, and the extension the specifier must carry is stripped before matching
	expect(resolve({ from: 'src/widgets/Button.tsx', specifier: '#src/common/utils/collectImportEdges.ts' })).toBe('src/common/utils/collectImportEdges.ts');
	// a barrel named outright matches its own path, without needing the /index probe
	expect(resolve({ from: 'src/widgets/Button.tsx', specifier: '#src/contracts/index.ts' })).toBe('src/contracts/index.ts');
	// the same barrel named as its folder still lands, this time via the probe
	expect(resolve({ from: 'src/widgets/Button.tsx', specifier: '#src/contracts' })).toBe('src/contracts/index.ts');
	// a second alias root is nothing special — it is one more leading segment to drop
	expect(resolve({ from: 'src/widgets/Button.tsx', specifier: '#tests/helpers/setupConsumerRepo.ts' })).toBe('tests/helpers/setupConsumerRepo.ts');
});
