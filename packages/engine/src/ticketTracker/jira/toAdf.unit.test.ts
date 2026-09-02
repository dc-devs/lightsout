import { describe, expect, test } from '@jest/globals';
import { toAdf } from '#src/ticketTracker/jira/toAdf.ts';

describe('toAdf', () => {
	test('parses paragraphs, hard breaks, headings, nested lists, and ordered starts', () => {
		expect(toAdf({ markdown: '## Heading\n\nfirst\nsecond\n\n3. three\n  - nested\n4. four' })).toStrictEqual({
			type: 'doc',
			version: 1,
			content: [
				{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] },
				{ type: 'paragraph', content: [{ type: 'text', text: 'first' }, { type: 'hardBreak' }, { type: 'text', text: 'second' }] },
				{
					type: 'orderedList',
					attrs: { order: 3 },
					content: [
						{
							type: 'listItem',
							content: [
								{ type: 'paragraph', content: [{ type: 'text', text: 'three' }] },
								{
									type: 'bulletList',
									content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'nested' }] }] }],
								},
							],
						},
						{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'four' }] }] },
					],
				},
			],
		});
	});

	test('decodes literal escapes and link destinations and parses canonical nested marks', () => {
		expect(toAdf({ markdown: '\\# **_`[value](https://example.com/a%20b%29)`_**' })).toStrictEqual({
			type: 'doc',
			version: 1,
			content: [
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: '# ' },
						{
							type: 'text',
							text: 'value',
							marks: [{ type: 'strong' }, { type: 'em' }, { type: 'code' }, { type: 'link', attrs: { href: 'https://example.com/a b)' } }],
						},
					],
				},
			],
		});
	});

	test('keeps escaped delimiters as literal text', () => {
		expect(toAdf({ markdown: String.raw`\# \`literal\`` })).toStrictEqual({
			type: 'doc',
			version: 1,
			content: [{ type: 'paragraph', content: [{ type: 'text', text: '# `literal`' }] }],
		});
	});

	test('keeps a nonconsecutive numbered block and unsupported Markdown literal', () => {
		const result = toAdf({ markdown: '3. one\n5. two\n\n> **quote**\n\n![image](url)' });

		expect(result.content).toStrictEqual([
			{ type: 'paragraph', content: [{ type: 'text', text: '3. one' }, { type: 'hardBreak' }, { type: 'text', text: '5. two' }] },
			{ type: 'paragraph', content: [{ type: 'text', text: '> **quote**' }] },
			{ type: 'paragraph', content: [{ type: 'text', text: '![image](url)' }] },
		]);
	});

	test('returns the canonical empty document', () => {
		expect(toAdf({ markdown: '' })).toStrictEqual({ type: 'doc', version: 1, content: [] });
	});
});
