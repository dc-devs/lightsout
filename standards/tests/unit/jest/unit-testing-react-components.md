# Unit Testing Components & Hooks

Component tests follow the same [Arrange-Act-Assert with setup factories](./unit-testing.md#test-structure--arrange-act-assert-with-setup-factories) structure as every other test. All mock rules from [unit-testing.md](./unit-testing.md#mocks) apply — typed `jest.fn` generics, typed factory wrappers, no mocking constant modules.

## Framework Basics

- Import from `@testing-library/react` (React) or `@testing-library/preact` (Preact) — check the package's `package.json`; the API is identical.
- Component test files use `.unit.test.tsx` (JSX requires `.tsx`), co-located with the component.
- **Framework route/page files never get co-located unit tests** — they are thin wiring (guards, layout, a screen render) verified through e2e tests and the screen component's own tests.
- Interactions use `userEvent` **when the package depends on `@testing-library/user-event`** (check its `package.json`); otherwise use `fireEvent` from the testing-library package. Never add the dependency yourself — that is the repo owner's decision, surfaced by `lightsout doctor`.

## The Render Pattern

Render inside the `setup()` factory; query and assert in the `test`. For a component, `render()` *is* the act, but by convention it lives in the arrange factory — the one accepted exception to "the act lives in the `test`". Query from `screen` — never destructure queries from `render()`.

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

const setupNotificationBanner = ({ isVisible = true }: { isVisible?: boolean } = {}) => {
	const onDismiss = jest.fn<() => void>();
	mockUseAppStore.mockReturnValue(isVisible);
	render(<NotificationBanner onDismiss={onDismiss} />);

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

## Query Priority

1. **`getByRole`** — mirrors how users and assistive technology find elements
2. **`getByLabelText`** — labeled form inputs
3. **`getByText`** — visible text
4. **`getByTestId`** — last resort (requires adding `data-testid` to source)

Use `query*` variants to assert an element is **not** rendered (they return `null` instead of throwing). Use `findBy*`/`waitFor` for elements that appear after an async update — a synchronous `getBy*` throws before the DOM settles.

## Mocking Component Dependencies

**Hooks** mock like utility functions — and the wrapper must forward parameters with matching types when the hook takes any (see [Mock Typing Rules](./unit-testing.md#mock-typing-rules)):

```typescript
const mockUseProjects = jest.fn<(params: { workspaceId: number }) => { data: Project[] }>();

jest.mock('@/features/projects/hooks/useProjects', () => ({
	useProjects: (params: { workspaceId: number }) => mockUseProjects(params),
}));
```

**Zustand-style stores**: `mockUseAppStore.mockReturnValue(value)` works only when the component calls the store **once**. When it reads multiple slices, run the real selectors against a mock state instead:

```typescript
const setupFeaturePanel = ({ isActive = true, label = 'Panel' }: { isActive?: boolean; label?: string } = {}) => {
	mockUseAppStore.mockImplementation((selector) => selector({ isActive, label }));
	render(<FeaturePanel />);
};
```

**Child components**: mock a child **only if it is itself a boundary** (its own module, or imported from another feature). Render **real** internal children (under this module's own `common/`) so they are covered through this boundary's tests — mocking an internal child leaves it with no coverage at all. When you do mock a boundary child, keep it minimal: just enough to verify props and conditional rendering.

## Testing User Interactions

`userEvent` is async — create the user in the test and `await` the interaction. The query that locates the interaction target groups with the act (the `userEvent` call), not with arrange:

```typescript
test('calls the dismiss handler when the dismiss button is clicked', async () => {
	const { onDismiss } = setupBanner();
	const user = userEvent.setup();

	const dismissButton = screen.getByRole('button', { name: /dismiss/i });
	await user.click(dismissButton);

	expect(onDismiss).toHaveBeenCalledTimes(1);
});
```

When the package lacks `@testing-library/user-event`, use `fireEvent` instead — synchronous, no setup object: `fireEvent.click(dismissButton);`. The same grouping rule applies: the target query groups with the act.

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
