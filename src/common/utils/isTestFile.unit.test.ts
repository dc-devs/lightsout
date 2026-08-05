import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTestFile } from '@/common/utils/isTestFile';

test('isTestFile: a whole path segment named test(s), __tests__, __mocks__, or e2e marks the file as test code', () => {
	assert.equal(isTestFile('tests/helpers/report.ts'), true);
	assert.equal(isTestFile('test/setup.ts'), true);
	assert.equal(isTestFile('packages/api/tests/fixtures/user.ts'), true);
	assert.equal(isTestFile('src/common/__tests__/add.ts'), true);
	assert.equal(isTestFile('src/common/__mocks__/fs.ts'), true);
	assert.equal(isTestFile('packages/web/e2e/login.ts'), true);
});

test('isTestFile: a .test. or .spec. infix marks the file wherever it lives', () => {
	assert.equal(isTestFile('src/common/utils/packageOf.unit.test.ts'), true);
	assert.equal(isTestFile('src/app/App.spec.tsx'), true);
	assert.equal(isTestFile('scan.test.js'), true);
});

test('isTestFile: production paths that merely contain the words are not test code', () => {
	assert.equal(isTestFile('src/latest/index.ts'), false, 'the segment match needs a boundary, not a substring');
	assert.equal(isTestFile('src/contest/rules.ts'), false);
	assert.equal(isTestFile('src/protest.ts'), false);
	assert.equal(isTestFile('src/testing.ts'), false);
	assert.equal(isTestFile('src/utils/testHarness.ts'), false);
	assert.equal(isTestFile('src/e2ehelpers/run.ts'), false);
	assert.equal(isTestFile('src/common/utils/runCommand.ts'), false);
});
