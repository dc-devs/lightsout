import { describe, expect, test } from '@jest/globals';
import { wrapText } from '#src/cli/common/utils/wrapText.ts';

describe('wrapText', () => {
	test('keeps text that already fits on one line', () => {
		expect(wrapText({ text: 'short enough', width: 40, indent: '  ' })).toStrictEqual(['  short enough']);
	});

	test('breaks at word boundaries and indents every line', () => {
		const lines = wrapText({ text: 'one two three four five six seven', width: 16, indent: '  ' });

		expect(lines).toStrictEqual(['  one two three', '  four five six', '  seven']);
	});

	test('counts the indent against the width, so wrapped lines still fit', () => {
		const lines = wrapText({ text: 'aaa bbb ccc', width: 10, indent: '     ' });

		expect(lines.every((line) => line.length <= 10)).toBe(true);
	});

	test('leaves a word longer than the width whole, so a path stays copyable', () => {
		const lines = wrapText({ text: 'see src/pipeline/common/utils/prepareRun.ts now', width: 20, indent: '' });

		// broken across lines a path cannot be clicked, copied, or searched for
		expect(lines).toContain('src/pipeline/common/utils/prepareRun.ts');
	});

	test('collapses the whitespace a multi-line source string carries in', () => {
		expect(wrapText({ text: '  one\n\ttwo   three  ', width: 40, indent: '' })).toStrictEqual(['one two three']);
	});

	test('an empty string produces no lines rather than a blank one', () => {
		expect(wrapText({ text: '', width: 40, indent: '  ' })).toStrictEqual([]);
	});
});
