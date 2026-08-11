---
summary: "a hook test that mocks more framework primitives than the hook under test uses"
checked: false
severity: advisory
---

## Testing Hooks in Isolation

Mock the framework's hook primitives with synchronous shims so the hook body executes without a render cycle; capture effect callbacks so tests can invoke them:

```typescript
// Mocked Imports
// -------------------------
let mockEffectCallback: (() => undefined | (() => void)) | undefined;

jest.mock('preact/hooks', () => ({
	useEffect: (cb: () => undefined | (() => void)) => {
		mockEffectCallback = cb;
	},
	useCallback: <T>(cb: T) => cb,
	useMemo: (factory: () => unknown) => factory(),
}));
// -------------------------

const setupEscapeKey = ({ isActive = true }: { isActive?: boolean } = {}) => {
	mockEffectCallback = undefined;
	const addEventListenerSpy = jest.spyOn(document, 'addEventListener');
	const onEscape = jest.fn<() => void>();
	useEscapeKey({ isActive, onEscape });

	return { addEventListenerSpy, onEscape };
};

describe('useEscapeKey', () => {
	test('adds a keydown event listener', () => {
		const { addEventListenerSpy } = setupEscapeKey({ isActive: true });

		mockEffectCallback!();

		expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
	});
});
```

Only mock the hook primitives the hook under test actually uses.
