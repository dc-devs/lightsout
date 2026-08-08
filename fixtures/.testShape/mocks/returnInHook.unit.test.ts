import { expect, describe, test, jest, beforeEach } from '@jest/globals';

const mockGetProfile = jest.fn<() => string>();

describe('returnInHook', () => {
	beforeEach(() => {
		mockGetProfile.mockReturnValue('p.png');
	});

	test('reads the profile', () => {
		expect(mockGetProfile()).toBe('p.png');
	});
});
