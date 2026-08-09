import { expect, describe, test } from '@jest/globals';
import { StandardsInputKind } from '@/contracts';
import type { StandardsCheckInput } from '@/contracts';
import { readTestFiles } from './readTestFiles.ts';

const setupTestFileInput = ({ contents }: { contents: Array<[string, string]> }): StandardsCheckInput => ({
	kind: StandardsInputKind.TestFile,
	cwd: '/repo',
	tests: contents.map(([file]) => file),
	contents: new Map(contents),
});

/**
 * Any input a rule that did NOT declare `test-file` would receive. The engine
 * never hands one of these to a rule that reads test files, so this stands in
 * for the arm the union permits but a run cannot produce.
 */
const setupOtherKindInput = (): StandardsCheckInput => ({
	kind: StandardsInputKind.CloneSpans,
	cwd: '/repo',
	source: ['src/subject.ts'],
	spans: [],
});

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
