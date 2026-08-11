import { expect, test } from '@jest/globals';
import { formatTokenCount } from '@/cli/common/formatting/formatTokenCount';

test('formatTokenCount: raw under 1k, one-decimal k under 1M, one-decimal M above', () => {
	expect(formatTokenCount({ count: 500 })).toBe('500');
	expect(formatTokenCount({ count: 1000 })).toBe('1.0k');
	expect(formatTokenCount({ count: 1500 })).toBe('1.5k');
	expect(formatTokenCount({ count: 1_000_000 })).toBe('1.0M');
	expect(formatTokenCount({ count: 2_500_000 })).toBe('2.5M');
});
