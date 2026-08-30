import { describe, expect, test } from '@jest/globals';
import { ConfigDocs } from '#src/contracts/index.ts';

describe('ConfigDocs', () => {
	test('accepts the block a repo actually writes — each surface a path and what it covers', () => {
		const parsed = ConfigDocs.parse([
			{ path: 'README.md', covers: 'The product tour and the index of every other document.' },
			{ path: 'docs/configuration.md', covers: 'Every lightsout.config.json key.' },
		]);

		expect(parsed).toStrictEqual([
			{ path: 'README.md', covers: 'The product tour and the index of every other document.' },
			{ path: 'docs/configuration.md', covers: 'Every lightsout.config.json key.' },
		]);
	});

	test('accepts a single surface — one document is a real declaration, not a half-filled block', () => {
		const parsed = ConfigDocs.parse([{ path: 'README.md', covers: 'The product tour.' }]);

		expect(parsed).toStrictEqual([{ path: 'README.md', covers: 'The product tour.' }]);
	});

	test('refuses a key it does not know — a misspelling would declare a surface with no description', () => {
		const parsed = ConfigDocs.safeParse([{ path: 'README.md', cover: 'the tour' }]);

		expect(parsed.success).toBe(false);
	});

	test('refuses an entry with no `covers`, because that line is what tells a drafter where a change belongs', () => {
		const parsed = ConfigDocs.safeParse([{ path: 'README.md' }]);

		expect(parsed.success).toBe(false);
	});

	test('refuses an entry with no `path`, because a surface nothing can be opened at is not a surface', () => {
		const parsed = ConfigDocs.safeParse([{ covers: 'Every lightsout.config.json key.' }]);

		expect(parsed.success).toBe(false);
	});

	test('refuses a blank `path` — an empty string is a present key that names no document', () => {
		const parsed = ConfigDocs.safeParse([{ path: '', covers: 'Every lightsout.config.json key.' }]);

		expect(parsed.success).toBe(false);
	});

	test('refuses a blank `covers` — a declared surface with no description tells a drafter nothing', () => {
		const parsed = ConfigDocs.safeParse([{ path: 'docs/configuration.md', covers: '' }]);

		expect(parsed.success).toBe(false);
	});

	test('refuses an entry that is not an object, so a bare path string never reads as a declared surface', () => {
		const parsed = ConfigDocs.safeParse(['README.md']);

		expect(parsed.success).toBe(false);
	});

	test('refuses an empty array — "declared, but nothing" opts into a check that can never fire', () => {
		const parsed = ConfigDocs.safeParse([]);

		expect(parsed.success).toBe(false);
	});
});
