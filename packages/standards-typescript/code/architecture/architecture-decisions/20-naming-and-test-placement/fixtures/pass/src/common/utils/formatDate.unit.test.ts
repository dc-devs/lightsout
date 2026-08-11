import { expect, describe, test } from '@jest/globals';
import { formatDate } from './formatDate';

// The file carries its export's name and casing, and its test sits next to it.
describe('formatDate', () => {
	test('renders the date as an ISO day', () => {
		const formatted = formatDate({ date: new Date('2026-08-08T12:00:00Z') });

		expect(formatted).toBe('2026-08-08');
	});
});
