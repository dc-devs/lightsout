import { expect, test } from '@jest/globals';
import { isTestFile } from '@/common/utils/isTestFile';

test('isTestFile: a whole path segment named test(s), __tests__, __mocks__, or e2e marks the file as test code', () => {
	expect(isTestFile('tests/helpers/report.ts')).toBe(true);
	expect(isTestFile('test/setup.ts')).toBe(true);
	expect(isTestFile('packages/api/tests/fixtures/user.ts')).toBe(true);
	expect(isTestFile('src/common/__tests__/add.ts')).toBe(true);
	expect(isTestFile('src/common/__mocks__/fs.ts')).toBe(true);
	expect(isTestFile('packages/web/e2e/login.ts')).toBe(true);
});

test('isTestFile: a .test. or .spec. infix marks the file wherever it lives', () => {
	expect(isTestFile('src/common/utils/packageOf.unit.test.ts')).toBe(true);
	expect(isTestFile('src/app/App.spec.tsx')).toBe(true);
	expect(isTestFile('scan.test.js')).toBe(true);
});

test('isTestFile: production paths that merely contain the words are not test code', () => {
	// the segment match needs a boundary, not a substring
	expect(isTestFile('src/latest/index.ts')).toBe(false);
	expect(isTestFile('src/contest/rules.ts')).toBe(false);
	expect(isTestFile('src/protest.ts')).toBe(false);
	expect(isTestFile('src/testing.ts')).toBe(false);
	expect(isTestFile('src/utils/testHarness.ts')).toBe(false);
	expect(isTestFile('src/e2ehelpers/run.ts')).toBe(false);
	expect(isTestFile('src/common/utils/runCommand.ts')).toBe(false);
});
