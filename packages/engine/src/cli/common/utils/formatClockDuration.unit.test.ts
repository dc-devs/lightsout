import { describe, expect, test } from '@jest/globals';
import { formatClockDuration } from '#src/cli/common/utils/formatClockDuration.ts';

describe('formatClockDuration', () => {
	test('keeps the minutes segment under a minute, so the column never narrows', () => {
		expect(formatClockDuration({ ms: 0 })).toBe('0m 00s');
		expect(formatClockDuration({ ms: 5_000 })).toBe('0m 05s');
	});

	test('zero-pads the seconds segment, which is what holds the column aligned', () => {
		expect(formatClockDuration({ ms: 123_000 })).toBe('2m 03s');
	});

	test('renders the sample block’s own durations exactly', () => {
		expect([160_000, 1_951_000, 651_000].map((ms) => formatClockDuration({ ms }))).toStrictEqual(['2m 40s', '32m 31s', '10m 51s']);
	});

	test('minutes pass sixty without rolling into hours', () => {
		expect(formatClockDuration({ ms: 4_203_000 })).toBe('70m 03s');
	});

	test('rounds to the nearest second rather than truncating', () => {
		expect(formatClockDuration({ ms: 1_600 })).toBe('0m 02s');
	});

	test('no duration at all renders the em dash — a row the run has not reached has no clock', () => {
		expect(formatClockDuration({})).toBe('—');
	});
});
