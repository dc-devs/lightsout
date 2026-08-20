import { expect, test } from '@jest/globals';
import { formatDuration } from '#src/index.ts';

test('formatDuration: em-dash for undefined, bare seconds under a minute, padded m/s at or above', () => {
	expect(formatDuration({ ms: undefined })).toBe('—');
	expect(formatDuration({ ms: 5400 })).toBe('5s');
	expect(formatDuration({ ms: 60000 })).toBe('1m 00s');
	expect(formatDuration({ ms: 65000 })).toBe('1m 05s');
	expect(formatDuration({ ms: 125000 })).toBe('2m 05s');
});

test('formatDuration: rounds to the nearest second, so sub-second input reads as 0s or 1s', () => {
	expect(formatDuration({ ms: 0 })).toBe('0s');
	expect(formatDuration({ ms: 400 })).toBe('0s');
	expect(formatDuration({ ms: 500 })).toBe('1s');
	expect(formatDuration({ ms: 5600 })).toBe('6s');
});

test('formatDuration: rounding decides the minute boundary, not the raw milliseconds', () => {
	expect(formatDuration({ ms: 59_400 })).toBe('59s');
	expect(formatDuration({ ms: 59_600 })).toBe('1m 00s');
});

test('formatDuration: a two-digit remainder is left unpadded, and minutes never roll into hours', () => {
	expect(formatDuration({ ms: 130_000 })).toBe('2m 10s');
	expect(formatDuration({ ms: 3_600_000 })).toBe('60m 00s');
	expect(formatDuration({ ms: 3_665_000 })).toBe('61m 05s');
});
