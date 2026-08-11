import { expect, describe, test } from '@jest/globals';
import { getAvatarUrl } from './index';

// The arrangement lives in module state the factory mutates, so what a test
// gets depends on what ran before it.
let currentProfile: string | null = null;

const setupAvatar = () => {
	return { userProfile: { avatar: currentProfile } };
};

describe('getAvatarUrl', () => {
	test('returns the profile avatar when one exists', () => {
		currentProfile = 'p.png';
		const { userProfile } = setupAvatar();

		const avatarUrl = getAvatarUrl({ userProfile });

		expect(avatarUrl).toBe('p.png');
	});
});
