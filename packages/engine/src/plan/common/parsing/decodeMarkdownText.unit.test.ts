import { describe, expect, test } from '@jest/globals';
import { decodeMarkdownText } from '#src/plan/common/parsing/decodeMarkdownText.ts';

describe('decodeMarkdownText', () => {
	test.each([
		{ text: '&amp;#9; &#99999999; &#x09; &unknown;', expected: '&#9; &#99999999; &#x09; &unknown;' },
		{ text: '&#9;&#160;&#8232;&#65279;', expected: '\t\u00a0\u2028\ufeff' },
		{ text: '&lt;node&gt;&#92;&#96;&#124;', expected: '<node>\\`|' },
	])('decodes only explicit escapes once: $text', ({ text, expected }) => {
		const decoded = decodeMarkdownText({ text });

		expect(decoded).toBe(expected);
	});
});
