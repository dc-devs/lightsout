---
summary: "a setup factory that arranges through anything but its own parameters"
checked: false
severity: advisory
---

### Setup Factories

```typescript
const setupAvatar = ({
	profile = null,
	gravatar = null,
}: { profile?: string | null; gravatar?: string | null } = {}) => {
	mockGetAvatarFromProfile.mockReturnValue(profile);
	mockGetAvatarFromGravatar.mockReturnValue(gravatar);

	const userProfile = new UserProfile({ profileData: { email: 'user@example.com' } });
	const appSettings = new AppSettings({ defaultPreferences: {} });

	return { userProfile, appSettings };
};
```
