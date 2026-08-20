import { describe, expect, jest, test } from '@jest/globals';
import { formatRelativeTime } from '#src/common/formatting/formatRelativeTime.ts';

const setupClock = ({ now }: { now: string }) => {
	jest.useFakeTimers();
	jest.setSystemTime(new Date(now));
};

describe('formatRelativeTime', () => {
	test('reads a recent timestamp as a distance from now', () => {
		setupClock({ now: '2026-01-01T00:03:00.000Z' });

		const label = formatRelativeTime({ at: '2026-01-01T00:00:00.000Z' });

		expect(label).toBe('3 minutes ago');
	});

	test('reads a day-old timestamp in the coarser unit date-fns picks', () => {
		setupClock({ now: '2026-01-02T00:00:00.000Z' });

		const label = formatRelativeTime({ at: '2026-01-01T00:00:00.000Z' });

		expect(label).toBe('1 day ago');
	});

	test('shows an unreadable timestamp as it was recorded', () => {
		const label = formatRelativeTime({ at: 'not-a-date' });

		expect(label).toBe('not-a-date');
	});
});
