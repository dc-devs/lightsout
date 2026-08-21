import { expect, test } from '@jest/globals';
import { packageOf } from '#src/common/workspace/packageOf.ts';

test.each([
	{ file: 'packages/api/src/index.ts', packagesDir: 'packages', expected: 'api' },
	{ file: 'packages/web-app/src/deep/nested/Widget.tsx', packagesDir: 'packages', expected: 'web-app' },
	{ file: 'packages/api/package.json', packagesDir: 'packages', expected: 'api' },
	{ file: 'apps/admin/src/index.ts', packagesDir: 'apps', expected: 'admin' },
])('packageOf: $file under $packagesDir belongs to $expected, however deep it sits', ({ file, packagesDir, expected }) => {
	const name = packageOf({ file, packagesDir });

	expect(name).toBe(expected);
});

test.each([
	{ case: 'a root-group file', file: 'src/index.ts', packagesDir: 'packages' },
	{ case: 'a file sitting directly in the packages dir', file: 'packages/README.md', packagesDir: 'packages' },
	{ case: 'an empty package segment', file: 'packages//api/index.ts', packagesDir: 'packages' },
	{ case: 'a near-miss prefix — the match is the whole directory segment plus its slash', file: 'packages-old/api/src/index.ts', packagesDir: 'packages' },
	{ case: 'a packages dir other than the configured one', file: 'packages/api/src/index.ts', packagesDir: 'apps' },
])('packageOf: $case belongs to no package', ({ file, packagesDir }) => {
	const name = packageOf({ file, packagesDir });

	expect(name).toBe(undefined);
});
