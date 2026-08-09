import { expect, describe, test } from '@jest/globals';
import { getLineNumber } from './getLineNumber.ts';

/**
 * A three-line document with known offsets: `const a = 1;` on line 1, an empty
 * line 2, `const b = 2;` on line 3. The two newlines sit at offsets 12 and 13,
 * and the whole text is 26 characters long.
 */
const setupDocument = () => {
	const text = ['const a = 1;', '', 'const b = 2;'].join('\n');

	return { text };
};

describe('getLineNumber', () => {
	test.each([
		{ label: 'the very first character', index: 0, expectedLine: 1 },
		{ label: 'a character mid-line', index: 6, expectedLine: 1 },
		{ label: 'the newline ending a line', index: 12, expectedLine: 1 },
		{ label: 'the newline ending the empty line', index: 13, expectedLine: 2 },
		{ label: 'the first character of the last line', index: 14, expectedLine: 3 },
		{ label: 'the offset one past the end', index: 26, expectedLine: 3 },
		// checks report spans from regex offsets, and an unbalanced source hands
		// this the mask's whole length — never an offset inside the text
		{ label: 'an offset beyond the end', index: 999, expectedLine: 3 },
	])('reports line $expectedLine for $label', ({ index, expectedLine }) => {
		const { text } = setupDocument();

		const line = getLineNumber({ text, index });

		expect(line).toBe(expectedLine);
	});
});
