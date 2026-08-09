import { expect, describe, test, jest } from '@jest/globals';

const mockGetLocale = jest.fn<() => string>();

const mockQueryResult = {
	data: 'p.png',
	isLoading: false,
	refetch: jest.fn(),
} as unknown as Record<string, unknown>;

describe('subject', () => {
	test('reads the locale and the stubbed field', () => {
		mockGetLocale.mockReturnValue('en-GB');

		expect(mockGetLocale() + mockQueryResult.data).toBe('en-GBp.png');
	});
});
