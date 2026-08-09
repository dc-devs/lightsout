import { expect, describe, test, jest, beforeEach } from '@jest/globals';

const mockGetTimezone = jest.fn<() => string>();

describe('subject', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('reads the timezone', () => {
		mockGetTimezone.mockReturnValue('UTC');

		expect(mockGetTimezone()).toBe('UTC');
	});
});
