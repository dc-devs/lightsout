import { describe, expect, test } from '@jest/globals';
import { toInlineMarkdown } from '#src/cli/common/queueBoard/toInlineMarkdown.ts';

/**
 * A plain text of `length` characters with no whitespace, holding an opening
 * square bracket at the 1-based position `bracketAt` when one is asked for.
 */
const setupLongText = ({ length, bracketAt }: { length: number; bracketAt?: number }) => {
	const text = Array.from({ length }, (_, index) => (index + 1 === bracketAt ? '[' : 'a')).join('');

	return { text };
};

describe('toInlineMarkdown', () => {
	test('collapses every run of whitespace, newlines included, into one space and trims both ends', () => {
		const text = ' \t first line\n\nsecond\t\tline   with  spaces \r\n ';

		const inline = toInlineMarkdown({ text });

		expect(inline).toBe('first line second line with spaces');
	});

	test('escapes pipes and square brackets so the text can neither end a table cell nor open a link', () => {
		const text = 'a|b [c] d||e]';

		const inline = toInlineMarkdown({ text });

		expect(inline).toBe('a\\|b \\[c\\] d\\|\\|e\\]');
	});

	test('clips text longer than maxLength to maxLength characters ending in an ellipsis before escaping', () => {
		const { text } = setupLongText({ length: 200, bracketAt: 119 });

		const inline = toInlineMarkdown({ text, maxLength: 120 });

		expect(inline).toBe(`${'a'.repeat(118)}\\[…`);
	});

	test('leaves text of exactly maxLength characters whole', () => {
		const { text } = setupLongText({ length: 120 });

		const inline = toInlineMarkdown({ text, maxLength: 120 });

		expect(inline).toBe('a'.repeat(120));
	});
});
