# Unit Test Examples

Both examples follow [Arrange-Act-Assert with setup factories](./unit-testing.md#test-structure--arrange-act-assert-with-setup-factories): arrangement in a named `setup()` factory; act and assertion in the `test`, each call assigned to a named `const`, blank line between the three blocks. Mock cleanup comes from `clearMocks`/`restoreMocks` config (see [Mock Cleanup](./unit-testing.md#mock-cleanup)) — never `beforeEach`.

## Function with Mocked Dependencies

```typescript
import { expect, describe, test, jest } from '@jest/globals';
import { UserProfile } from '@/models/user-profile';
import { AppSettings } from '@/models/app-settings';
import { getAvatarUrl } from '@/models/user-profile/common/utils/get-avatar-url';

// Mocked Imports
// -------------------------
const mockGetAvatarFromProfile = jest.fn<(params: { profile: UserProfile }) => string | null>();

jest.mock('@/models/user-profile/common/utils/get-avatar-from-profile', () => ({
	getAvatarFromProfile: (params: { profile: UserProfile }) =>
		mockGetAvatarFromProfile(params),
}));
// -------------------------
const mockGetAvatarFromGravatar = jest.fn<(params: { email: string }) => string | null>();

jest.mock('@/models/user-profile/common/utils/get-avatar-from-gravatar', () => ({
	getAvatarFromGravatar: (params: { email: string }) =>
		mockGetAvatarFromGravatar(params),
}));
// -------------------------

const setupAvatar = ({
	profile = null,
	gravatar = null,
	setting,
}: {
	profile?: string | null;
	gravatar?: string | null;
	setting?: 'hasCustomAvatar' | 'useGravatar';
} = {}) => {
	mockGetAvatarFromProfile.mockReturnValue(profile);
	mockGetAvatarFromGravatar.mockReturnValue(gravatar);

	const userProfile = new UserProfile({
		profileData: { email: 'user@example.com', displayName: 'Test User' },
	});
	const appSettings = new AppSettings({ isGuest: false, defaultPreferences: {} });
	if (setting) {
		appSettings.set(setting, true);
	}

	return { userProfile, appSettings };
};

describe('getAvatarUrl', () => {
	test('returns null when no avatar conditions are met', () => {
		const { userProfile, appSettings } = setupAvatar();

		const avatarUrl = getAvatarUrl({ userProfile, appSettings });

		expect(avatarUrl).toBeNull();
	});

	test('returns the profile avatar when the user has a custom avatar', () => {
		const { userProfile, appSettings } = setupAvatar({
			profile: 'https://cdn.example.com/avatars/user-123.png',
			setting: 'hasCustomAvatar',
		});

		const avatarUrl = getAvatarUrl({ userProfile, appSettings });

		expect(avatarUrl).toBe('https://cdn.example.com/avatars/user-123.png');
	});
});
```

The same shape covers async units: the factory uses `mockResolvedValue`/`mockRejectedValue`, the act is `await`ed, and the rejection case asserts with `await expect(getUserData({ userId: '999' })).rejects.toThrow('Not found')`.

For a class, the factory returns the constructor's collaborators and the act constructs the instance. Asserting the instance's resolved public fields (`expect(person).toEqual(expect.objectContaining(details))`) is still testing *behavior* — for a class whose job is to resolve and expose that state, those fields are the output a consumer reads. "Test behavior, not internals" bans reaching into things a consumer never touches (private helpers, caches), not reading the public result.

## Parameterized with test.each

```typescript
import { expect, describe, test } from '@jest/globals';
import { formatCurrency } from '@/common/utils/format-currency';

describe('formatCurrency', () => {
	test.each([
		{ amount: 100, locale: 'en-US', expected: '$1.00' },
		{ amount: 100, locale: 'en-GB', expected: '£1.00' },
		{ amount: 0, locale: 'en-US', expected: '$0.00' },
		{ amount: -50, locale: 'en-US', expected: '-$0.50' },
	])(
		'formats $amount in $locale as $expected',
		({ amount, locale, expected }) => {
			const formatted = formatCurrency({ amount, locale });

			expect(formatted).toBe(expected);
		},
	);
});
```
