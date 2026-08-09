import { expect, describe, test, jest, beforeAll, afterEach } from '@jest/globals';

const mockGetTimezone = jest.fn<() => string>();

describe('cleanupInEveryHook', () => {
	beforeAll(() => {
		mockGetTimezone.mockClear();
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	test('reads the timezone', () => {
		mockGetTimezone.mockReturnValue('UTC');

		expect(mockGetTimezone()).toBe('UTC');
	});
});
