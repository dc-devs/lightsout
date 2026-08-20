import { describe, expect, test } from '@jest/globals';
import { StandardsInputKind } from '@lightsout/standards-contracts';
import { setupTestFileInput } from '#src/index.ts';

describe('setupTestFileInput', () => {
	test('builds the arm a test-file check narrows to', () => {
		expect(setupTestFileInput().kind).toBe(StandardsInputKind.TestFile);
	});

	test('the pairs become the contents map, and their paths become the test list', () => {
		const input = setupTestFileInput({ contents: [['src/app.unit.test.ts', 'test("x", () => {});']] });

		// a rule about test files is handed only test files, so there is no
		// separate source list to keep in step
		expect(input).toMatchObject({
			tests: ['src/app.unit.test.ts'],
			contents: new Map([['src/app.unit.test.ts', 'test("x", () => {});']]),
		});
	});

	test('with nothing passed, it carries no tests rather than an invented one', () => {
		expect(setupTestFileInput()).toMatchObject({ tests: [], contents: new Map() });
	});
});
