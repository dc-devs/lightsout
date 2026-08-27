import { describe, expect, test } from '@jest/globals';
import { slugifyHeading } from '#src/common/utils/slugifyHeading.ts';

describe('slugifyHeading', () => {
	test('lower-cases the words and joins them with single hyphens', () => {
		expect(slugifyHeading({ text: 'How verification works' })).toBe('how-verification-works');
	});

	test('a heading spelling a word in backticks slugs the same as one that does not', () => {
		expect(slugifyHeading({ text: 'Recommended `.gitignore`' })).toBe('recommended-gitignore');
		expect(slugifyHeading({ text: 'Recommended .gitignore' })).toBe('recommended-gitignore');
	});

	test('a link in a heading contributes its label and not its target', () => {
		expect(slugifyHeading({ text: 'See [the monorepo guide](./monorepos.md)' })).toBe('see-the-monorepo-guide');
	});

	test('emphasis marks fall away rather than becoming separators', () => {
		expect(slugifyHeading({ text: '**Adding** your _standards_' })).toBe('adding-your-standards');
	});

	test('a run of punctuation collapses to one hyphen, and none is left dangling at either end', () => {
		expect(slugifyHeading({ text: '  Use lightsout’s code standards — really!  ' })).toBe('use-lightsout-s-code-standards-really');
	});

	test('a heading with nothing sluggable in it yields an empty id rather than a lone hyphen', () => {
		expect(slugifyHeading({ text: '???' })).toBe('');
	});
});
