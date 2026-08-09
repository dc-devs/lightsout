import { expect, describe, test, jest } from '@jest/globals';

const mockGetLocale = jest.fn();

describe('subject', () => {
	test('reads the locale', () => {
		mockGetLocale.mockReturnValue('en-GB');

		expect(mockGetLocale()).toBe('en-GB');
	});
});
