import { expect, describe, test, jest } from '@jest/globals';
import { getAvatarUrl } from './index';

// Mocked Imports
// -------------------------
const mockGetAvatarFromProfile = jest.fn<(params: { email: string }) => string | null>();

jest.mock('./common/utils/getAvatarFromProfile', () => ({
	getAvatarFromProfile: (params: { email: string }) => mockGetAvatarFromProfile(params),
}));
// -------------------------

const setupAvatar = ({ profile = null }: { profile?: string | null } = {}) => {
	mockGetAvatarFromProfile.mockReturnValue(profile);

	const userProfile = { email: 'user@example.com' };

	return { userProfile };
};

describe('getAvatarUrl', () => {
	test('returns null when no avatar conditions are met', () => {
		const { userProfile } = setupAvatar();

		const avatarUrl = getAvatarUrl({ userProfile });

		expect(avatarUrl).toBeNull();
	});

	test('returns the profile avatar when the user has a custom avatar', () => {
		const { userProfile } = setupAvatar({ profile: 'https://cdn.example.com/avatars/user-123.png' });

		const avatarUrl = getAvatarUrl({ userProfile });

		expect(avatarUrl).toBe('https://cdn.example.com/avatars/user-123.png');
	});
});
