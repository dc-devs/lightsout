import { expect, test } from '@jest/globals';
import { packageOf } from '@/common/utils/packageOf';

test('packageOf: a file under <packagesDir>/<name>/ belongs to that package, however deep it sits', () => {
	expect(packageOf({ file: 'packages/api/src/index.ts', packagesDir: 'packages' })).toBe('api');
	expect(packageOf({ file: 'packages/web-app/src/deep/nested/Widget.tsx', packagesDir: 'packages' })).toBe('web-app');
	expect(packageOf({ file: 'packages/api/package.json', packagesDir: 'packages' })).toBe('api');
	expect(packageOf({ file: 'apps/admin/src/index.ts', packagesDir: 'apps' })).toBe('admin');
});

test('packageOf: root-group files, bare entries in the packages dir, and near-miss prefixes belong to no package', () => {
	expect(packageOf({ file: 'src/index.ts', packagesDir: 'packages' })).toBe(undefined);
	// a file sitting directly in the packages dir is root-group, not a package
	expect(packageOf({ file: 'packages/README.md', packagesDir: 'packages' })).toBe(undefined);
	// an empty package segment names no package
	expect(packageOf({ file: 'packages//api/index.ts', packagesDir: 'packages' })).toBe(undefined);
	// the match is the whole directory segment plus its slash
	expect(packageOf({ file: 'packages-old/api/src/index.ts', packagesDir: 'packages' })).toBe(undefined);
	// only the configured packages dir counts
	expect(packageOf({ file: 'packages/api/src/index.ts', packagesDir: 'apps' })).toBe(undefined);
});
