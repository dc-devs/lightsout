import { expect, test } from '@jest/globals';
import { formatTokenCount } from '#src/index.ts';

test('formatTokenCount: raw under 1k, one-decimal k under 1M, one-decimal M above', () => {
	expect(formatTokenCount({ count: 500 })).toBe('500');
	expect(formatTokenCount({ count: 1000 })).toBe('1.0k');
	expect(formatTokenCount({ count: 1500 })).toBe('1.5k');
	expect(formatTokenCount({ count: 1_000_000 })).toBe('1.0M');
	expect(formatTokenCount({ count: 2_500_000 })).toBe('2.5M');
});

test('formatTokenCount: boundaries — zero and the last raw count, and the last count below a million', () => {
	expect(formatTokenCount({ count: 0 })).toBe('0');
	expect(formatTokenCount({ count: 999 })).toBe('999');
	expect(formatTokenCount({ count: 999_999 })).toBe('1000.0k');
});

test('formatTokenCount: the single decimal is rounded, not truncated, in both the k and M ranges', () => {
	expect(formatTokenCount({ count: 1449 })).toBe('1.4k');
	expect(formatTokenCount({ count: 1460 })).toBe('1.5k');
	expect(formatTokenCount({ count: 1_234_567 })).toBe('1.2M');
	expect(formatTokenCount({ count: 9_876_543 })).toBe('9.9M');
});

test('formatTokenCount: a count below a thousand is stringified untouched, decimals and minus sign included', () => {
	expect(formatTokenCount({ count: 12.5 })).toBe('12.5');
	expect(formatTokenCount({ count: -50 })).toBe('-50');
});
