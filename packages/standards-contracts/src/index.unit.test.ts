import { describe, expect, test } from '@jest/globals';
import { RawStandardsFinding, StandardsCheckModule, StandardsInputKind, StandardsPackageRoot, StandardsSet } from './index.ts';

/**
 * The package entry, tested as the thing a rule author actually imports.
 *
 * Each shape is proven by its own file's tests; what is proven here is that the
 * entry still hands them out. A re-export that stopped resolving — a rename, a
 * moved file, a barrel entry dropped in a merge — breaks every standards package
 * in the world while every one of those other tests keeps passing.
 */
describe('the package entry', () => {
	test('hands out every shape a standards package is written against', () => {
		expect(Object.entries({ RawStandardsFinding, StandardsCheckModule, StandardsPackageRoot }).filter(([, schema]) => schema === undefined)).toStrictEqual([]);
	});

	test('names the two document trees by the folder names they must match on disk', () => {
		// these are not labels: a package puts its rules in folders called exactly
		// this, and the loader walks for exactly these names
		expect(StandardsSet).toStrictEqual({ Code: 'code', Tests: 'tests' });
	});

	test('names every input kind by the string a check writes in its module', () => {
		// a check declares `inputKind: 'syntax-tree'` as a plain literal, narrowed
		// by the module type — so these strings are the contract, not an enum
		expect(StandardsInputKind).toStrictEqual({
			FileList: 'file-list',
			FileText: 'file-text',
			SyntaxTree: 'syntax-tree',
			TestFile: 'test-file',
			ImportGraph: 'import-graph',
			CloneSpans: 'clone-spans',
		});
	});
});
