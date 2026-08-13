import { expect, test } from '@jest/globals';
import { createSpecifierResolver } from '@/common/utils/createSpecifierResolver';

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
