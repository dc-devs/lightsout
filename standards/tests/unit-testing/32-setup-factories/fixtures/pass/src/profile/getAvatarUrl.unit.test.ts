import { expect, describe, test } from '@jest/globals';
import { getAvatarUrl } from './index';

const setupAvatar = ({ profile = null }: { profile?: string | null } = {}) => {
	const userProfile = { avatar: profile };

	return { userProfile };
};

const setupGuestAvatar = () => {
	const userProfile = { avatar: null, isGuest: true };

	return { userProfile };
};

describe('getAvatarUrl', () => {
	test('returns the profile avatar when one exists', () => {
		const { userProfile } = setupAvatar({ profile: 'p.png' });

		const avatarUrl = getAvatarUrl({ userProfile });

		expect(avatarUrl).toBe('p.png');
	});
});
