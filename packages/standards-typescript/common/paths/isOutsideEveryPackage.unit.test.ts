import { describe, expect, test } from '@jest/globals';
import { isOutsideEveryPackage } from './isOutsideEveryPackage.ts';

describe('isOutsideEveryPackage', () => {
	test('a file under a workspace package belongs to it', () => {
		expect(isOutsideEveryPackage({ path: 'packages/engine/src/run.ts', packageDirectories: ['.', 'packages/engine'] })).toBe(false);
	});

	test('a repo-root script belongs to none of the packages beside it', () => {
		expect(isOutsideEveryPackage({ path: 'scripts/buildDocs.mjs', packageDirectories: ['.', 'packages/engine'] })).toBe(true);
	});

	test('nothing is outside when the manifests declare no workspace package — the whole repo is one package', () => {
		expect(isOutsideEveryPackage({ path: 'scripts/buildDocs.mjs', packageDirectories: ['.'] })).toBe(false);
	});

	test('nothing is outside when no package directory is known at all', () => {
		expect(isOutsideEveryPackage({ path: 'scripts/buildDocs.mjs', packageDirectories: [] })).toBe(false);
	});

	test('a package root covers only paths beneath it, never a sibling whose name merely starts with it', () => {
		expect(isOutsideEveryPackage({ path: 'packages/engine-tools/src/run.ts', packageDirectories: ['.', 'packages/engine'] })).toBe(true);
	});

	test('the bare package root is not itself inside the package — it is a directory, not a file the rule judges', () => {
		expect(isOutsideEveryPackage({ path: 'packages/engine', packageDirectories: ['.', 'packages/engine'] })).toBe(true);
	});
});
