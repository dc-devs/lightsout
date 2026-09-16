import { describe, expect, test } from '@jest/globals';
import { encodeMarkdownTableCell } from '#src/plan/common/rewriting/encodeMarkdownTableCell.ts';

describe('encodeMarkdownTableCell', () => {
	test('encodes delimiter and entity text once while preserving leading and trailing spaces', () => {
		const text = '  A &amp; <b> \\ | `name`\r\n ';

		const encoded = encodeMarkdownTableCell({ text });

		expect(encoded).toBe('&#32;&#32;A &amp;amp; &lt;b&gt; &#92; &#124; &#96;name&#96;&#13;&#10;&#32;');
	});

	test.each([
		{ text: '', expected: '' },
		{ text: 'plain internal spaces', expected: 'plain internal spaces' },
		{ text: '   ', expected: '&#32;&#32;&#32;' },
	])('preserves ordinary or empty text $text', ({ text, expected }) => {
		const encoded = encodeMarkdownTableCell({ text });

		expect(encoded).toBe(expected);
	});
});
