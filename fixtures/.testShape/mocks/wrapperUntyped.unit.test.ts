import { expect, describe, test, jest } from '@jest/globals';

const mockGetProfile = jest.fn<(params: { userId: string }) => string>();

jest.mock('@/profile/getProfile', () => ({
	getProfile: () => mockGetProfile(),
}));

describe('wrapperUntyped', () => {
	test('forwards the user id', () => {
		mockGetProfile.mockReturnValue('p.png');

		expect(mockGetProfile).toHaveBeenCalledWith({ userId: 'u1' });
	});
});
