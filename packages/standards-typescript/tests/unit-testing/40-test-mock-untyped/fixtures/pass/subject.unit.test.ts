import { expect, describe, test, jest } from '@jest/globals';

const mockGetLocale = jest.fn<() => string>();

const mockQueryResult = {
	data: 'p.png',
	isLoading: false,
	refetch: jest.fn(),
} as unknown as Record<string, unknown>;

// A test whose subject reads code as text passes that code in as data. This is
// a mention of an untyped spy, not one — the rule reads what the file does, not
// what it quotes.
const sampleLine = 'const getAvatar = jest.fn();';

describe('subject', () => {
	test('reads the locale and the stubbed field', () => {
		mockGetLocale.mockReturnValue('en-GB');

		expect(mockGetLocale() + mockQueryResult.data).toBe('en-GBp.png');
	});

	test('carries its sample line untouched', () => {
		expect(sampleLine).toContain('getAvatar');
	});
});
