import assert from 'node:assert/strict';
import { test } from 'node:test';
import { packageOf } from '@/common/utils/packageOf';

test('packageOf: a file under <packagesDir>/<name>/ belongs to that package, however deep it sits', () => {
	assert.equal(packageOf({ file: 'packages/api/src/index.ts', packagesDir: 'packages' }), 'api');
	assert.equal(packageOf({ file: 'packages/web-app/src/deep/nested/Widget.tsx', packagesDir: 'packages' }), 'web-app');
	assert.equal(packageOf({ file: 'packages/api/package.json', packagesDir: 'packages' }), 'api');
	assert.equal(packageOf({ file: 'apps/admin/src/index.ts', packagesDir: 'apps' }), 'admin');
});

test('packageOf: root-group files, bare entries in the packages dir, and near-miss prefixes belong to no package', () => {
	assert.equal(packageOf({ file: 'src/index.ts', packagesDir: 'packages' }), undefined);
	assert.equal(packageOf({ file: 'packages/README.md', packagesDir: 'packages' }), undefined, 'a file sitting directly in the packages dir is root-group, not a package');
	assert.equal(packageOf({ file: 'packages//api/index.ts', packagesDir: 'packages' }), undefined, 'an empty package segment names no package');
	assert.equal(packageOf({ file: 'packages-old/api/src/index.ts', packagesDir: 'packages' }), undefined, 'the match is the whole directory segment plus its slash');
	assert.equal(packageOf({ file: 'packages/api/src/index.ts', packagesDir: 'apps' }), undefined, 'only the configured packages dir counts');
});
