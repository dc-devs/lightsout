---
summary: "a test that does not read as arrange, act, assert with its arrangement in a `setup()` factory"
checked: false
severity: advisory
---

## Test Structure — Arrange-Act-Assert with Setup Factories

Every test follows **Arrange-Act-Assert**, with arrangement extracted into a named `setup()` factory. The test body stays small: call setup, act, assert.

```typescript
describe('getAvatarUrl', () => {
	test('returns the profile avatar when one exists', () => {
		const { userProfile, appSettings } = setupAvatar({ profile: 'p.png' });

		const avatarUrl = getAvatarUrl({ userProfile, appSettings });

		expect(avatarUrl).toBe('p.png');
	});
});
```

**Rules:**
