import { describe, expect, test } from '@jest/globals';
import { fromAdf } from '#src/queue/tracker/jira/fromAdf.ts';

const doc = (content: unknown[]) => ({ type: 'doc', version: 1, content });
const paragraph = (content: unknown[]) => ({ type: 'paragraph', content });

describe('fromAdf', () => {
	test('serializes supported blocks, hard breaks, nested lists, and ordered starts canonically', () => {
		const value = doc([
			{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] },
			paragraph([{ type: 'text', text: 'first' }, { type: 'hardBreak' }, { type: 'text', text: 'second' }]),
			{
				type: 'orderedList',
				attrs: { order: 3 },
				content: [
					{
						type: 'listItem',
						content: [
							paragraph([{ type: 'text', text: 'three' }]),
							{ type: 'bulletList', content: [{ type: 'listItem', content: [paragraph([{ type: 'text', text: 'nested' }])] }] },
						],
					},
					{ type: 'listItem', content: [paragraph([{ type: 'text', text: 'four' }])] },
				],
			},
		]);

		expect(fromAdf({ value })).toBe('## Heading\n\nfirst\nsecond\n\n3. three\n  - nested\n4. four');
	});

	test('normalizes and coalesces supported marks while retaining text from unknown and unusable marks', () => {
		const value = doc([
			paragraph([
				{ type: 'text', text: 'one', marks: [{ type: 'em' }, { type: 'strong' }] },
				{ type: 'text', text: ' two', marks: [{ type: 'strong' }, { type: 'em' }] },
				{ type: 'text', text: ' linked', marks: [{ type: 'link', attrs: { href: 'https://example.com/a b)' } }] },
				{ type: 'text', text: ' plain', marks: [{ type: 'link', attrs: {} }, { type: 'strike' }] },
			]),
		]);

		expect(fromAdf({ value })).toBe('**_one two_**[ linked](https://example.com/a%20b%29) plain');
	});

	test('escapes literal Markdown syntax and block-looking prefixes', () => {
		expect(fromAdf({ value: doc([paragraph([{ type: 'text', text: '# *x* [y](z) \\' }])]) })).toBe('\\# \\*x\\* \\[y\\]\\(z\\) \\\\');
		expect(fromAdf({ value: doc([paragraph([{ type: 'text', text: '2. item' }])]) })).toBe('2\\. item');
	});

	test('normalizes absent and empty descriptions and rejects malformed nonempty ADF', () => {
		expect(fromAdf({ value: undefined })).toBe('');
		expect(fromAdf({ value: null })).toBe('');
		expect(fromAdf({ value: doc([]) })).toBe('');
		expect(fromAdf({ value: { type: 'doc', version: 2, content: [] } })).toBeUndefined();
		expect(fromAdf({ value: doc([paragraph([{ type: 'text' }])]) })).toBeUndefined();
	});

	test('flattens descendant text from unknown valid nodes in document order', () => {
		const value = doc([{ type: 'panel', content: [{ type: 'mystery', content: [{ type: 'text', text: '- retained' }] }] }]);

		expect(fromAdf({ value })).toBe('\\- retained');
	});
});
