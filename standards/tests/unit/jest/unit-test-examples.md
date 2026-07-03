# Unit Test Examples

Every example follows [Arrange-Act-Assert with setup factories](./unit-testing.md#test-structure--arrange-act-assert-with-setup-factories): arrangement lives in a named `setup()` factory; the act and assertion live in the `test`, each call assigned to a named `const`, with a blank line between the three blocks. Mock cleanup is handled by `clearMocks` / `restoreMocks` config (see [Mock Cleanup](./unit-testing.md#mock-cleanup)) — never by `beforeEach`.

## Unit Test File (for a Class)

> **Behavior vs. internals:** this example asserts the `Person`'s resolved fields (`departmentId`, `personType`, etc.). That is still testing *behavior*, not internals — for a class whose job is to resolve and expose that state, those fields are the public output a consumer reads. The "test behavior, not internals" rule only bans reaching into things a consumer never touches (private helpers, caches, intermediate variables).

```typescript
import { expect, describe, test, jest } from '@jest/globals';
import { Person } from '@/models/person';
import { Address } from '@/models/address';
import { PersonConfig } from '@/models/person-config';
import type { IPersonDetails } from '@/models/person/common/interfaces';

// Mocked Imports
// -------------------------
const mockGetPersonDetails = jest.fn<(params: { personId: string; locale: Locale }) => IPersonDetails | null>();

jest.mock('@/models/person/common/utils/get-person-details', () => ({
	getPersonDetails: (params: { personId: string; locale: Locale }) => mockGetPersonDetails(params),
}));
// -------------------------

const setupPerson = ({ details = null }: { details?: IPersonDetails | null } = {}) => {
	mockGetPersonDetails.mockReturnValue(details);

	const address = new Address({
		addressData: { street: '123 Main St', city: 'Springfield', zip: '12345' },
	});
	const personConfig = new PersonConfig({
		isAnonymous: false,
		currentLocale: {} as Locale,
		defaultSettings: {},
	});

	return { address, personConfig };
};

describe('Person', () => {
	test('sets employee details when the person is an employee', () => {
		const employeeDetails: IPersonDetails = {
			departmentId: '456',
			managerId: '789',
			personType: 'employee',
			companyName: 'acme-corp.com',
			companyPath: '/org/engineering/team-a',
			companyUrl: 'https://acme-corp.com/org/engineering/team-a',
		};
		const { address, personConfig } = setupPerson({ details: employeeDetails });

		const person = new Person({ isAnonymous: false, address, personConfig });

		expect(person).toEqual(expect.objectContaining(employeeDetails));
	});

	test('sets contractor details when the person is a contractor', () => {
		const contractorDetails: IPersonDetails = { contractorId: '123', personType: 'contractor' };
		const { address, personConfig } = setupPerson({ details: contractorDetails });

		const person = new Person({ isAnonymous: false, address, personConfig });

		expect(person).toEqual(expect.objectContaining(contractorDetails));
	});

	test('leaves detail properties unset when no details are found', () => {
		const { address, personConfig } = setupPerson({ details: null });

		const person = new Person({ isAnonymous: false, address, personConfig });

		expect(person).toEqual(
			expect.objectContaining({
				contractorId: undefined,
				accountId: undefined,
				vendorId: undefined,
				personType: undefined,
				departmentId: undefined,
				managerId: undefined,
				companyName: undefined,
				companyPath: undefined,
				companyUrl: undefined,
			}),
		);
	});
});
```

---

## Unit Test File (for a Function)

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
	const appSettings = new AppSettings({
		isGuest: false,
		currentTheme: {} as Theme,
		defaultPreferences: {},
	});
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

	test('returns the gravatar avatar when gravatar is enabled', () => {
		const { userProfile, appSettings } = setupAvatar({
			gravatar: 'https://gravatar.com/avatar/abc123?size=200',
			setting: 'useGravatar',
		});

		const avatarUrl = getAvatarUrl({ userProfile, appSettings });

		expect(avatarUrl).toBe('https://gravatar.com/avatar/abc123?size=200');
	});
});
```

---

## Unit Test File (Async Function)

```typescript
import { expect, describe, test, jest } from '@jest/globals';
import { getUserData } from '@/services/user/common/utils/get-user-data';

// Mocked Imports
// -------------------------
const mockFetchUser = jest.fn<(params: { userId: string }) => Promise<UserData>>();

jest.mock('@/services/user/common/utils/fetch-user', () => ({
	fetchUser: (params: { userId: string }) => mockFetchUser(params),
}));
// -------------------------

const setupUserData = ({
	user = null,
	error = null,
}: { user?: UserData | null; error?: Error | null } = {}) => {
	if (error) {
		mockFetchUser.mockRejectedValue(error);
	} else {
		mockFetchUser.mockResolvedValue(user as UserData);
	}
};

describe('getUserData', () => {
	test('returns the user data when the user exists', async () => {
		setupUserData({ user: { id: '1', name: 'Test User' } });

		const result = await getUserData({ userId: '1' });

		expect(result).toStrictEqual({ id: '1', name: 'Test User' });
	});

	test('throws when the user does not exist', async () => {
		setupUserData({ error: new Error('User not found') });

		await expect(getUserData({ userId: '999' })).rejects.toThrow('User not found');
	});
});
```

---

## Unit Test File (Component)

```typescript
import { expect, describe, test, jest } from '@jest/globals';
import { render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { NotificationBanner } from './NotificationBanner';

// Mocked Imports
// -------------------------
const mockUseAppStore = jest.fn<(selector: (state: unknown) => unknown) => unknown>();

jest.mock('@store/appStore', () => ({
	useAppStore: (selector: (state: unknown) => unknown) => mockUseAppStore(selector),
}));
// -------------------------
const mockUseDismissHandler = jest.fn<() => () => void>();

jest.mock('@common/hooks/useDismissHandler', () => ({
	useDismissHandler: () => mockUseDismissHandler(),
}));
// -------------------------

const setupNotificationBanner = ({ isVisible = true }: { isVisible?: boolean } = {}) => {
	const onDismiss = jest.fn<() => void>();
	mockUseAppStore.mockReturnValue(isVisible);
	mockUseDismissHandler.mockReturnValue(onDismiss);
	render(<NotificationBanner />);

	return { onDismiss };
};

describe('NotificationBanner', () => {
	test('does not render the banner when not visible', () => {
		setupNotificationBanner({ isVisible: false });

		const banner = screen.queryByRole('alert');

		expect(banner).not.toBeInTheDocument();
	});

	test('renders the notification message when visible', () => {
		setupNotificationBanner({ isVisible: true });

		const message = screen.getByText('Action required');

		expect(message).toBeInTheDocument();
	});

	test('calls the dismiss handler when the dismiss button is clicked', async () => {
		const { onDismiss } = setupNotificationBanner({ isVisible: true });
		const user = userEvent.setup();

		const dismissButton = screen.getByRole('button', { name: /dismiss/i });
		await user.click(dismissButton);

		expect(onDismiss).toHaveBeenCalledTimes(1);
	});
});
```

---

## Unit Test File (Parameterized with test.each)

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
