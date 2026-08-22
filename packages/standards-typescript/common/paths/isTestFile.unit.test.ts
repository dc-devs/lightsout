import { describe, expect, test } from '@jest/globals';
import { isTestFile } from './isTestFile.ts';

describe('isTestFile', () => {
	test('a whole path segment naming a test directory marks everything under it', () => {
		expect(isTestFile({ path: 'tests/helpers/report.ts' })).toBe(true);
		expect(isTestFile({ path: 'test/setup.ts' })).toBe(true);
		expect(isTestFile({ path: 'src/common/__tests__/add.ts' })).toBe(true);
		expect(isTestFile({ path: 'src/common/__mocks__/fs.ts' })).toBe(true);
		expect(isTestFile({ path: 'packages/web/e2e/login.ts' })).toBe(true);
	});

	test('a .test. or .spec. infix marks the file wherever it lives', () => {
		expect(isTestFile({ path: 'src/common/utils/formatRate.unit.test.ts' })).toBe(true);
		expect(isTestFile({ path: 'src/app/App.spec.tsx' })).toBe(true);
	});

	test('a path that merely contains the words is production code', () => {
		// the segment match needs a boundary, not a substring
		expect(isTestFile({ path: 'src/latest/index.ts' })).toBe(false);
		expect(isTestFile({ path: 'src/contest/rules.ts' })).toBe(false);
		expect(isTestFile({ path: 'src/testing.ts' })).toBe(false);
		expect(isTestFile({ path: 'src/utils/testHarness.ts' })).toBe(false);
		expect(isTestFile({ path: 'src/e2ehelpers/run.ts' })).toBe(false);
	});

	test('an ordinary source path is not test code', () => {
		expect(isTestFile({ path: 'src/common/utils/formatRate.ts' })).toBe(false);
	});

	test('inside a standards pack, a tests/ directory names a document set rather than test code', () => {
		const standardsPacks = ['standards'];

		// a rule about how to write tests — its implementation is ordinary source,
		// and must answer to the source rules like any other file
		expect(isTestFile({ path: 'standards/tests/unit-testing/40-test-mock-untyped/check.ts', standardsPacks })).toBe(false);
		// the same path with no package declared above it is test code
		expect(isTestFile({ path: 'standards/tests/unit-testing/40-test-mock-untyped/check.ts' })).toBe(true);
	});

	test('a real test inside a standards pack is still test code, by its name', () => {
		const standardsPacks = ['standards'];

		expect(isTestFile({ path: 'standards/common/utils/scanTestLines.unit.test.ts', standardsPacks })).toBe(true);
	});

	test('inside a standards pack, __tests__, __mocks__ and e2e still mark test code', () => {
		const standardsPacks = ['standards'];

		// only `tests/` collides with a document set name
		expect(isTestFile({ path: 'standards/common/__mocks__/fs.ts', standardsPacks })).toBe(true);
		expect(isTestFile({ path: 'standards/e2e/login.ts', standardsPacks })).toBe(true);
	});

	test('a pack root covers only paths beneath it, never one that merely starts with its name', () => {
		expect(isTestFile({ path: 'standards-archive/tests/check.ts', standardsPacks: ['standards'] })).toBe(true);
	});
});
