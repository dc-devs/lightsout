import { describe, expect, test } from '@jest/globals';
import { formatBytes } from '#src/features/plans/common/utils/formatBytes.ts';

describe('formatBytes', () => {
	test.each([
		{ bytes: 0, reads: '0 B' },
		{ bytes: 812, reads: '812 B' },
		{ bytes: 1024, reads: '1.0 KB' },
		{ bytes: 4300, reads: '4.2 KB' },
		{ bytes: 1024 * 1024, reads: '1.0 MB' },
		{ bytes: 1_363_148, reads: '1.3 MB' },
	])('reads $bytes bytes as $reads', ({ bytes, reads }) => {
		expect(formatBytes({ bytes })).toBe(reads);
	});
});
