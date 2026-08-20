import { describe, expect, test } from '@jest/globals';
import { formatCount } from '#src/common/formatting/formatCount.ts';

const setupCount = ({ count, noun, plural }: { count: number; noun: string; plural?: string }) => ({ count, noun, plural });

describe('formatCount', () => {
	test('leaves the noun alone when there is exactly one of the thing', () => {
		const params = setupCount({ count: 1, noun: 'file' });

		const label = formatCount(params);

		expect(label).toBe('1 file');
	});

	test('adds an s for any other count, none included', () => {
		const params = setupCount({ count: 0, noun: 'file' });

		const label = formatCount(params);

		expect(label).toBe('0 files');
	});

	test('uses the plural it was given where adding an s would not produce one', () => {
		const params = setupCount({ count: 2, noun: 'writer batch', plural: 'writer batches' });

		const label = formatCount(params);

		expect(label).toBe('2 writer batches');
	});
});
