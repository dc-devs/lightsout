import { expect, describe, test, jest } from '@jest/globals';

const mockQueryResult = {
	data: 'p.png',
	isLoading: false,
	refetch: jest.fn(),
} as unknown as Record<string, unknown>;

describe('frameworkCastSpy', () => {
	test('reads the stubbed field', () => {
		expect(mockQueryResult.data).toBe('p.png');
	});
});
