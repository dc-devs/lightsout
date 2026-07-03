# Unit Testing Components

Component tests follow the same [Arrange-Act-Assert with setup factories](./unit-testing.md#test-structure--arrange-act-assert-with-setup-factories) structure as every other test: arrange in a `setup()` factory (mocks + `render`), then act and assert in the `test`, with each call assigned to a named `const` and a blank line between the three blocks.

## Testing Library Import

The import source depends on the package's framework:

| Framework | Import from |
|---|---|
| React | `@testing-library/react` |
| Preact | `@testing-library/preact` |

The API (`render`, `screen`, queries) is identical across both libraries — only the import source differs. Check the package's `package.json` dependencies to determine which framework it uses. Interactions use `userEvent`, not `fireEvent` — see [Testing User Interactions](#testing-user-interactions).

## Test File Naming

Component test files use `.unit.test.tsx` — the `.tsx` extension is required because the test contains JSX (`render(<Component />)`). This follows the repo convention: `.tsx` only when the file contains JSX, `.ts` for everything else.

```
src/components/StatusBanner/
├── StatusBanner.tsx
├── StatusBanner.unit.test.tsx
└── common/
    ├── hooks/
    └── components/
```

## Components That Must NOT Have Unit Tests

Framework route/page files — files whose sole purpose is wiring a route to a screen component (e.g., TanStack Router route files, Next.js page files) — must never have co-located unit tests. These files are thin configuration: permission guards, layout wrappers, and component renders. They contain no testable logic. Route behavior is verified through e2e tests and the screen component's own unit tests.

## The Render Pattern

Render inside a `setup()` factory; query and assert in the `test`. For a component, `render()` *is* the act, but by convention it lives in the arrange factory rather than the test body — this is the one accepted exception to "the act lives in the `test`". Query elements from `screen` — never destructure queries from `render()`. Assign each query to a named `const` (no nested calls), with a blank line between arrange, act, and assert.

```typescript
import { expect, describe, test } from '@jest/globals';
import { render, screen } from '@testing-library/preact';
import { StatusBanner } from './StatusBanner';

const setupStatusBanner = ({ message = 'All systems operational' }: { message?: string } = {}) => {
	render(<StatusBanner message={message} />);
};

describe('StatusBanner', () => {
	test('renders the message', () => {
		setupStatusBanner({ message: 'All systems operational' });

		const message = screen.getByText('All systems operational');

		expect(message).toBeInTheDocument();
	});
});
```

## Query Priority

Choose queries in this order:

1. **`getByRole`** — buttons, headings, textboxes, etc. Mirrors how users and assistive technology find elements.
2. **`getByLabelText`** — form inputs with associated labels.
3. **`getByText`** — visible text content.
4. **`getByTestId`** — last resort. Requires adding `data-testid` to the source file.

Use `query*` variants (`queryByRole`, `queryByText`) when asserting an element is **not** rendered — they return `null` instead of throwing.

Use `findBy*` / `waitFor` to assert elements that appear after an async update (e.g. a resolved promise following an interaction) — a synchronous `getBy*` throws before the DOM settles.

## Mocking Dependencies

Before mocking any module, check that the "Do NOT Mock Simple Constants" rule in [unit-testing.md](./unit-testing.md#do-not-mock-simple-constants) does not apply. Only mock constant modules when they have import-time side effects or you need to vary the value per test.

Set mock return values inside the `setup()` factory — not a `beforeEach`. With `clearMocks: true` in config, call tracking resets automatically before each test and each `setup()` re-sets return values fresh (see [Mock Cleanup](./unit-testing.md#mock-cleanup)).

### Custom Hooks

Mock hooks the same way as utility functions. **Always check the hook's source signature first** — if it takes parameters, the wrapper must accept and forward them with matching types. Using `() => mockFn()` for a hook that takes parameters silently discards arguments, causing `toHaveBeenCalledWith` assertions to fail.

**Hook with no parameters:**

```typescript
// Mocked Imports
// -------------------------
const mockUseBannerState = jest.fn<() => BannerState>();

jest.mock('./common/hooks/useBannerState', () => ({
	useBannerState: () => mockUseBannerState(),
}));
// -------------------------
```

**Hook with parameters:**

```typescript
// Mocked Imports
// -------------------------
const mockUseProjects = jest.fn<(params: { workspaceId: number; refetchInterval?: number | false }) => { data: Project[] }>();

jest.mock('@/features/projects/hooks/useProjects', () => ({
	useProjects: (params: { workspaceId: number; refetchInterval?: number | false }) =>
		mockUseProjects(params),
}));
// -------------------------
```

Wire the return value in the setup factory:

```typescript
const setupBanner = ({ isVisible = true, message = 'System operational' }: { isVisible?: boolean; message?: string } = {}) => {
	mockUseBannerState.mockReturnValue({ isVisible, message });
	render(<StatusBanner />);
};
```

### Zustand Stores

For components using `useStore(selector)`, mock the store module and control the selector return value:

```typescript
// Mocked Imports
// -------------------------
const mockUseAppStore = jest.fn<(selector: (state: unknown) => unknown) => unknown>();

jest.mock('@store/appStore', () => ({
	useAppStore: (selector: (state: unknown) => unknown) => mockUseAppStore(selector),
}));
// -------------------------
```

Return the value the selector would produce, from the setup factory:

```typescript
const setupFeaturePanel = ({ isActive = true }: { isActive?: boolean } = {}) => {
	mockUseAppStore.mockReturnValue(isActive);
	render(<FeaturePanel />);
};

describe('FeaturePanel', () => {
	test('renders the panel when the feature is active', () => {
		setupFeaturePanel({ isActive: true });

		const panel = screen.getByRole('region');

		expect(panel).toBeInTheDocument();
	});
});
```

`mockReturnValue` works only when the component calls `useStore` **once** — it returns the same value for every selector. When a component reads multiple slices (`useStore(selectA)`, `useStore(selectB)`), run the real selector against a mock state instead, so each call gets its own slice:

```typescript
const setupFeaturePanel = ({ isActive = true, label = 'Panel' }: { isActive?: boolean; label?: string } = {}) => {
	const mockState = { isActive, label };
	mockUseAppStore.mockImplementation((selector) => selector(mockState));
	render(<FeaturePanel />);
};
```

### Child Components

Mock a child component **only if it is itself a boundary** — its own module, or a component imported from another feature. Render **real** internal children — those under this module's own `common/` (e.g., `./common/components/ActionButton`) — so they are covered through this boundary's tests, per the [Module Boundary Testing](./unit-testing.md#module-boundary-testing) rules. Mocking an internal child leaves it with neither boundary coverage nor a dedicated test file.

When you do mock a boundary child, keep the mock minimal — render just enough to verify the parent passes correct props and renders children conditionally:

```typescript
// Mocked Imports
// -------------------------
jest.mock('./common/components/ActionButton', () => ({
	ActionButton: (props: Record<string, unknown>) => (
		<button data-testid="action-button" onClick={props.onClick as () => void}>
			{props.label as string}
		</button>
	),
}));
// -------------------------
```

## Testing Conditional Rendering

When a component returns `null` under certain conditions, use `query*` to assert absence. Drive both states from the same factory via a parameter:

```typescript
const setupInstructionBar = ({ isActive = false }: { isActive?: boolean } = {}) => {
	mockUseAppStore.mockReturnValue(isActive);
	render(<InstructionBar />);
};

describe('InstructionBar', () => {
	test('does not render when not active', () => {
		setupInstructionBar({ isActive: false });

		const instruction = screen.queryByText('Select element');

		expect(instruction).not.toBeInTheDocument();
	});

	test('renders the instruction text when active', () => {
		setupInstructionBar({ isActive: true });

		const instruction = screen.getByText('Select element');

		expect(instruction).toBeInTheDocument();
	});
});
```

## Testing User Interactions

Use **`@testing-library/user-event`** — it simulates real focus/pointer/keyboard sequences, unlike `fireEvent`'s single raw event. `userEvent` is async, so create the user in the test and `await` the interaction.

The query that locates the interaction target groups with the act (the `userEvent` call), not with arrange — keep them in the same block, separated from the `setup()`/`userEvent.setup()` arrange block and the `expect` assertion by blank lines.

```typescript
import { render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';

const setupBanner = () => {
	const onDismiss = jest.fn<() => void>();
	render(<Banner message="Notice" onDismiss={onDismiss} />);

	return { onDismiss };
};

describe('Banner', () => {
	test('calls the dismiss handler when the dismiss button is clicked', async () => {
		const { onDismiss } = setupBanner();
		const user = userEvent.setup();

		const dismissButton = screen.getByRole('button', { name: /dismiss/i });
		await user.click(dismissButton);

		expect(onDismiss).toHaveBeenCalledTimes(1);
	});
});
```
