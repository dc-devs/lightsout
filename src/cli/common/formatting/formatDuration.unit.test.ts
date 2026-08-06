import { expect, test } from '@jest/globals';
import { formatDuration } from '@/cli/common/formatting/formatDuration';

test('formatDuration: em-dash for undefined, bare seconds under a minute, padded m/s at or above', () => {
	expect(formatDuration({ ms: undefined })).toBe('—');
	expect(formatDuration({ ms: 5400 })).toBe('5s');
	expect(formatDuration({ ms: 60000 })).toBe('1m 00s');
	expect(formatDuration({ ms: 65000 })).toBe('1m 05s');
	expect(formatDuration({ ms: 125000 })).toBe('2m 05s');
});
