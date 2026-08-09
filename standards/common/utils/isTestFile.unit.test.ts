import { expect, describe, test } from '@jest/globals';
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
});
