import { expect, test } from '@jest/globals';
import { isTestFile } from '#src/common/sourceFiles/isTestFile.ts';

test('isTestFile: a whole path segment named test(s), __tests__, __mocks__, or e2e marks the file as test code', () => {
	expect(isTestFile({ path: 'tests/helpers/report.ts' })).toBe(true);
	expect(isTestFile({ path: 'test/setup.ts' })).toBe(true);
	expect(isTestFile({ path: 'packages/api/tests/fixtures/user.ts' })).toBe(true);
	expect(isTestFile({ path: 'src/common/__tests__/add.ts' })).toBe(true);
	expect(isTestFile({ path: 'src/common/__mocks__/fs.ts' })).toBe(true);
	expect(isTestFile({ path: 'packages/web/e2e/login.ts' })).toBe(true);
});

test('isTestFile: a .test. or .spec. infix marks the file wherever it lives', () => {
	expect(isTestFile({ path: 'src/common/utils/packageOf.unit.test.ts' })).toBe(true);
	expect(isTestFile({ path: 'src/app/App.spec.tsx' })).toBe(true);
	expect(isTestFile({ path: 'scan.test.js' })).toBe(true);
});

test('isTestFile: production paths that merely contain the words are not test code', () => {
	// the segment match needs a boundary, not a substring
	expect(isTestFile({ path: 'src/latest/index.ts' })).toBe(false);
	expect(isTestFile({ path: 'src/contest/rules.ts' })).toBe(false);
	expect(isTestFile({ path: 'src/protest.ts' })).toBe(false);
	expect(isTestFile({ path: 'src/testing.ts' })).toBe(false);
	expect(isTestFile({ path: 'src/utils/testHarness.ts' })).toBe(false);
	expect(isTestFile({ path: 'src/e2ehelpers/run.ts' })).toBe(false);
	expect(isTestFile({ path: 'src/common/utils/runCommand.ts' })).toBe(false);
});

test('isTestFile: inside a standards pack, a tests/ directory names a document set, not test code', () => {
	const standardsPacks = ['standards'];

	// the rules a pack states about how to write tests — its own implementation,
	// which is ordinary source and must answer to the source rules like any other
	expect(isTestFile({ path: 'standards/tests/unit-testing/40-test-mock-untyped/check.ts', standardsPacks })).toBe(false);
	// the very same path is test code when no package is declared above it
	expect(isTestFile({ path: 'standards/tests/unit-testing/40-test-mock-untyped/check.ts' })).toBe(true);
});

test('isTestFile: a real test inside a standards pack is still test code, by its name', () => {
	const standardsPacks = ['standards'];

	expect(isTestFile({ path: 'standards/tests/unit-testing/40-test-mock-untyped/check.unit.test.ts', standardsPacks })).toBe(true);
	expect(isTestFile({ path: 'standards/common/utils/scanTestLines.unit.test.ts', standardsPacks })).toBe(true);
});

test('isTestFile: inside a standards pack, __tests__, __mocks__ and e2e still mark test code', () => {
	const standardsPacks = ['standards'];

	// only `tests/` collides with a document set name — the others mean what they always mean
	expect(isTestFile({ path: 'standards/common/__mocks__/fs.ts', standardsPacks })).toBe(true);
	expect(isTestFile({ path: 'standards/common/__tests__/add.ts', standardsPacks })).toBe(true);
	expect(isTestFile({ path: 'standards/e2e/login.ts', standardsPacks })).toBe(true);
});

test('isTestFile: a pack root only covers paths beneath it, never one that merely starts with its name', () => {
	const standardsPacks = ['standards'];

	// `standards-archive/` is a different folder, so its tests/ is a test directory
	expect(isTestFile({ path: 'standards-archive/tests/unit-testing/check.ts', standardsPacks })).toBe(true);
});
