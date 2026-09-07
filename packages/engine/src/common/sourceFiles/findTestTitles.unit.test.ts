import { expect, test } from '@jest/globals';
import { findTestTitles } from '#src/common/sourceFiles/findTestTitles.ts';

test("findTestTitles: reads titles from test call heads and their modifiers, and returns an each head's template as written", () => {
	const content = [
		"test('a plain literal title', () => {});",
		'it("a double quoted title", () => {});',
		"xit('an xit title', () => {});",
		"xtest('an xtest title', () => {});",
		"fit('a fit title', () => {});",
		"test.only('an only title', () => {});",
		"it.skip('a skipped title', () => {});",
		"test.concurrent.failing('a concurrent failing title', () => {});",
		"test.each([{ n: 1 }])('an each table title %s', () => {});",
		'test.each`',
		'\tn',
		'\t${1}',
		"`('an each template title $n', () => {});",
		"describe('a describe block name', () => {",
		"\ttest('a nested literal title', () => {});",
		'});',
		"const label = 'a bare string in a variable';",
		"// a comment naming 'a title that heads no call'",
	].join('\n');

	const titles = findTestTitles({ content });

	expect(titles).toEqual([
		'a plain literal title',
		'a double quoted title',
		'an xit title',
		'an xtest title',
		'a fit title',
		'an only title',
		'a skipped title',
		'a concurrent failing title',
		'an each table title %s',
		'an each template title $n',
		'a nested literal title',
	]);
});

test('findTestTitles: skips a call head whose title is a variable or an interpolated template', () => {
	const content = [
		"const name = 'a title held in a variable';",
		'test(name, () => {});',
		"const suffix = 'suffix';",
		'it(`an interpolated ${suffix} title`, () => {});',
		"test('a readable literal title', () => {});",
	].join('\n');

	const titles = findTestTitles({ content });

	expect(titles).toEqual(['a readable literal title']);
});
