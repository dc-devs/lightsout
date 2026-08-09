import { expect, describe, test, jest, beforeEach } from '@jest/globals';
import { getAvatarUrl } from './index';

const mockGetAvatarFromProfile = jest.fn();

jest.mock('./common/utils/getAvatarFromProfile', () => ({
	getAvatarFromProfile: () => mockGetAvatarFromProfile(),
}));

// No setup factory, arrangement in a hook, the act nested inside the matcher,
// and an untyped mock whose wrapper drops the parameters it is handed.
let userProfile: { email: string };

describe('getAvatarUrl', () => {
	beforeEach(() => {
		userProfile = { email: 'user@example.com' };
		mockGetAvatarFromProfile.mockReturnValue(null);
	});

	test('avatar', () => {
		expect(getAvatarUrl({ userProfile })).toBeNull();
	});
});
