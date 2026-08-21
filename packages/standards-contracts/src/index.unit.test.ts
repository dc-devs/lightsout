import { describe, expect, test } from '@jest/globals';
import * as contracts from '#src/index.ts';

/**
 * The package entry, tested as the thing a rule author actually imports.
 *
 * This is the one barrel a dedicated test belongs on — the file the package
 * names in its `exports` map, which nothing inside this package consumes. A
 * re-export that stopped resolving (a rename, a moved file, an entry dropped in
 * a merge) breaks every standards package in the world while every other test
 * here keeps passing.
 *
 * What each shape DOES is proven by its own file's tests. Nothing below reaches
 * into one.
 */
describe('the package entry', () => {
	test('hands out exactly the surface a standards package is written against', () => {
		expect(Object.keys(contracts).sort()).toStrictEqual([
			'RawStandardsFinding',
			'StandardsCheckModule',
			'StandardsInputKind',
			'StandardsPackageRoot',
			'StandardsSet',
		]);
	});

	test('every name arrived as a value rather than erasing to undefined', () => {
		// The failure this catches is a type export where a value was meant: it
		// typechecks, it satisfies the name list above under `import *`, and it is
		// `undefined` the moment a rule author calls it.
		expect(Object.entries(contracts).filter(([, value]) => value === undefined)).toStrictEqual([]);
	});
});
