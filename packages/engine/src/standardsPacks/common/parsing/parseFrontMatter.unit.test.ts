import { describe, expect, test } from '@jest/globals';
import { parseFrontMatter } from '#src/standardsPacks/common/parsing/parseFrontMatter.ts';

describe('parseFrontMatter', () => {
	test('splits a leading block into declarations and the prose that follows', () => {
		const { data, body } = parseFrontMatter({
			text: '---\nsummary: one export per file\nchecked: true\nsettings:\n  maxLines: 50\n---\n\n# Functions\n\nProse.\n',
		});

		// every declared field, typed as YAML read it
		expect(data).toStrictEqual({ summary: 'one export per file', checked: true, settings: { maxLines: 50 } });
		// the body starts after the closing marker, untouched
		expect(body).toBe('\n# Functions\n\nProse.\n');
	});

	test('treats a file with no front matter as declaring nothing', () => {
		const { data, body } = parseFrontMatter({ text: '# Functions\n\nProse.\n' });

		// not an error — every field the callers read has a default
		expect(data).toStrictEqual({});
		expect(body).toBe('# Functions\n\nProse.\n');
	});

	test('ignores a block that is not a set of declarations', () => {
		const { data, body } = parseFrontMatter({ text: '---\n- one\n- two\n---\nProse.\n' });

		// a YAML list declares no fields, so it declares nothing
		expect(data).toStrictEqual({});
		expect(body).toBe('Prose.\n');
	});

	test('refuses a malformed block, quoting the line the author has to look at', () => {
		const parse = () => parseFrontMatter({ text: '---\nsummary: {unclosed\n---\n\nProse.\n' });

		// the message names the offending line rather than a character offset
		expect(parse).toThrow('front matter is not valid YAML (starting "summary: {unclosed")');
	});
});
