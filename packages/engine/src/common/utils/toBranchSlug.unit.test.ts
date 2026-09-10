import { describe, expect, test } from '@jest/globals';
import { toBranchSlug } from '#src/common/utils/toBranchSlug.ts';

describe('toBranchSlug', () => {
	test.each([
		{ label: 'lowercases and joins words with single dashes', text: 'Drain The Backlog', expected: 'drain-the-backlog' },
		{ label: 'collapses a run of punctuation and spacing into one dash', text: 'Fix: the (broken) thing!', expected: 'fix-the-broken-thing' },
		{ label: 'drops the dashes leading and trailing text would leave', text: '  --Ship it--  ', expected: 'ship-it' },
		{ label: 'keeps digits, which a ticket reference is mostly made of', text: 'LO-42 phase 3', expected: 'lo-42-phase-3' },
		{ label: 'answers an empty word when nothing in the text is branch-safe', text: '???', expected: '' },
		{ label: 'answers an empty word for text with no characters at all', text: '', expected: '' },
	])('$label', ({ text, expected }) => {
		const slug = toBranchSlug({ text });

		expect(slug).toBe(expected);
	});

	test('cuts a long title back to the last whole word rather than mid-word', () => {
		const slug = toBranchSlug({ text: 'Rework the entire deterministic verification pipeline end to end' });

		expect(slug).toBe('rework-the-entire-deterministic');
	});

	test('cuts a single long word at the limit, because there is no whole word to cut back to', () => {
		const slug = toBranchSlug({ text: 'Supercalifragilisticexpialidociousandthensomemore' });

		expect(slug).toBe('supercalifragilisticexpialidociousandthe');
	});
});
