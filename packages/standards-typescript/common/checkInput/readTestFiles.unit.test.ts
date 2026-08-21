import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupTestFileInput } from '@lightsout/standards-testkit';
import { readTestFiles } from './readTestFiles.ts';

describe('readTestFiles', () => {
	test('returns each test file as a path-and-text pair, in the order the contents map holds them', () => {
		const input = setupTestFileInput({
			contents: [
				['src/first.unit.test.ts', 'describe("first", () => {});'],
				['src/second.unit.test.ts', 'describe("second", () => {});'],
			],
		});

		const files = readTestFiles({ input });

		expect(files).toStrictEqual([
			{ file: 'src/first.unit.test.ts', text: 'describe("first", () => {});' },
			{ file: 'src/second.unit.test.ts', text: 'describe("second", () => {});' },
		]);
	});

	test('returns nothing when the input carries no test files', () => {
		const input = setupTestFileInput({ contents: [] });

		const files = readTestFiles({ input });

		expect(files).toStrictEqual([]);
	});

	test('returns nothing for an input of any other kind rather than refusing', () => {
		const files = readTestFiles({ input: setupOtherKindInput() });

		expect(files).toStrictEqual([]);
	});
});
