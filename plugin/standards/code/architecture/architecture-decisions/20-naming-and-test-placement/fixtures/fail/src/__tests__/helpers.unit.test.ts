import { expect, describe, test } from '@jest/globals';
import { formatDate } from '../helpers';

// Two faults in one repo: the file is named for its role rather than its
// export, and its test sits in a `__tests__/` directory instead of beside it.
describe('formatDate', () => {
	test('renders the date as an ISO day', () => {
		const formatted = formatDate({ date: new Date('2026-08-08T12:00:00Z') });

		expect(formatted).toBe('2026-08-08');
	});
});
