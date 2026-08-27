import { describe, expect, test } from '@jest/globals';
import { isWithinLastDays } from '#src/features/repo/common/utils/isWithinLastDays.ts';

/** A moment the given number of hours before now, as an ISO string — what a manifest would have recorded then. */
const hoursAgo = ({ hours }: { hours: number }) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

describe('isWithinLastDays', () => {
	test('keeps a moment inside the window', () => {
		expect(isWithinLastDays({ at: hoursAgo({ hours: 24 }), days: 7 })).toBe(true);
	});

	test('drops a moment older than the window, which is what makes the tile say "last seven days" honestly', () => {
		expect(isWithinLastDays({ at: hoursAgo({ hours: 24 * 8 }), days: 7 })).toBe(false);
	});

	test('counts the window from now rather than from the start of a calendar week', () => {
		expect(isWithinLastDays({ at: hoursAgo({ hours: 24 * 7 - 1 }), days: 7 })).toBe(true);
	});

	test('leaves a timestamp the clock cannot read outside every window rather than inside all of them', () => {
		expect(isWithinLastDays({ at: 'not a date', days: 7 })).toBe(false);
	});
});
