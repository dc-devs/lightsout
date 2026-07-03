# Unit Testing

## Module Boundary Testing

Tests target **module boundaries** — a module's public API — not every file individually. Internals are covered *through* the boundary. This pins tests to behavior rather than internal decomposition: refactoring a module's internals never breaks its tests.

**Classify every source file before writing tests:**

| Classification | Definition | Test file? |
|---|---|---|
| **Boundary** | A module's public surface: shared leaf modules under a root-layer `common/` (e.g., `src/common/utils/`, `src/app/common/`); a feature's public exports (hooks, components, top-level operation files); framework files (`.service.ts`, `.resolver.ts`, `.controller.ts`, guards, job services); a graduated folder's main file (`HttpClient/HttpClient.ts`) | ✅ Co-located `*.unit.test.ts` |
| **Internal** | A file under a *module's* `common/` — i.e., a `common/` whose parent folder is a feature, route, screen, component, or class folder (not a root layer like `src/`) | ❌ No dedicated test file — covered through the owning module's boundary tests |

**Rules:**

- Coverage is still measured per source file: an internal must reach 100% lines/branches/functions, achieved by driving the boundary's inputs.
- If an internal branch cannot be reached through any boundary input, it is **dead code** — flag it for deletion. Do not write a direct test to cover it.
- If covering an internal through the boundary is impractical (combinatorial inputs), that is the promotion signal: the internal has earned its own module and direct tests. Flag it in the report — do not silently create a dedicated test file.
- Existing dedicated test files on internals are migration debt: leave them in place and do not extend them — new coverage goes through the boundary. Flag them in the report as migration candidates.

## Test File Location

Unit tests are **co-located** with their source files. Place the test file in the same directory as the file being tested, using the naming convention `*.unit.test.ts`.

For instance, the below file:

```
src/auth/AuthService.ts
```

Will have a unit test file located at:

```
src/auth/AuthService.unit.test.ts
```

### Benefits of Co-location

- **Discoverability** - Tests are immediately visible next to source files
- **Maintenance** - Moving/renaming a module keeps the test with it
- **Ownership clarity** - Each module is self-contained with its tests
- **Encourages testing** - Missing test files are obvious

### Folder Structure Example

```
src/auth/
├── AuthService.ts
├── AuthService.unit.test.ts
├── TokenStore.ts
├── TokenStore.unit.test.ts
└── __mocks__/
    └── AuthService.ts          # Mock for AuthService used by other tests
```

## Files That Must NOT Have Dedicated Tests

Do **not** create test files for source files that contain no runtime logic. These files are covered naturally when consumed by the modules that import them — a dedicated test adds noise and zero value.

Skip writing tests for:

- **Pure constants** — files that only export a literal value (string, number, static object/array) with no computation, branching, or side effects (e.g., `serverName.ts` exporting `'my-app'`)
- **Enums with no computed members** — plain TypeScript enums or string-union types
- **Type-only files** — files that export only `type` or `interface` declarations (these have no runtime code at all)
- **Barrel / re-export files** — `index.ts` files that only re-export from other modules

A file qualifies for testing only when it contains **executable logic**: conditionals, function bodies, computed values, or side effects.

If a constant file *does* contain logic (e.g., reads an env var and falls back to a default), test the logic paths — not the static default value.

## Base Test File

1. Add the below as the first import statement in the file:

```typescript
import {
	expect,
	describe,
	test,
	jest,
} from '@jest/globals';
```

Import `beforeEach`, `afterEach`, or `afterAll` only when actually needed. With setup factories (below) and `clearMocks` / `restoreMocks` config (see [Mock Cleanup](#mock-cleanup)), most tests need no hooks at all.

Import `jest` only when the file actually uses it (`jest.fn`, `jest.mock`, or `jest.spyOn`). A file with no mocks — e.g. a pure `test.each` over a function — omits it to avoid an unused import that fails `noUnusedLocals` / lint.

2. The first `describe` statement will always match the name of the class/function being tested.

**src/auth/AuthService.unit.test.ts**

```typescript
import {
	expect,
	describe,
	test,
	jest,
} from '@jest/globals';

describe('AuthService', () => {
	// test code here..
});
```

The template imports `jest` for completeness — drop it if the file ends up with no `jest.fn` / `jest.mock` / `jest.spyOn`, per the rule above.

## Describe Block Naming

- The first `describe` always matches the name of the class or function being tested
- Keep `describe` blocks **flat**. Scenario variants come from `setup()` parameters or separate named factories — not from nested `describe` + `beforeEach` pyramids (see [Test Structure](#test-structure--arrange-act-assert-with-setup-factories))
- When you do nest, nested `describe` blocks use one of two prefixes:
  - **`when ...`** — describes the condition or state being set up (e.g., `'when the request fails'`)
  - **`for ...`** — describes a variant within a condition (e.g., `'for an employee'`)

## Test Structure — Arrange-Act-Assert with Setup Factories

Every test follows **Arrange-Act-Assert**, with the arrangement extracted into a named `setup()` factory. The test body stays small: call setup, act, assert.

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

- **Arrange in a `setup()` factory.** The factory wires mocks and builds fixtures, then returns the locals the test needs as `const`s. Do **not** hold the subject under test in a shared `let` reassigned across `beforeEach` blocks — that is mutable test state, and it forces readers to trace setup up and down the file.
- **Act and assert live in the `test`**, not in `beforeEach`. Once setup is a factory, a `beforeEach` is rarely needed. (Component tests are the one accepted exception: `render()` is the act but lives in the `setup()` factory by convention — see [unit-testing-react-components.md](./unit-testing-react-components.md#the-render-pattern).)
- **One `setup()` and one act per test.** Two setups or two acts means two tests. Multiple `expect`s are fine only when they assert one behavior's result. (`userEvent.setup()` is not an arrange factory and doesn't count toward this — see [Testing User Interactions](./unit-testing-react-components.md#testing-user-interactions).)
- **No nested method calls in the act.** Assign each call's result to a named `const` and reference it — never nest one call inside another's arguments when building the subject under test. Two exceptions: (1) the error case, where the act must sit inside the matcher: `expect(() => parse(bad)).toThrow()`; (2) assertion-matcher composition such as `toEqual(expect.objectContaining(...))` or `expect.any(...)`, where nesting matchers is the intended form.
- **Blank line between arrange, act, and assert.** The spacing makes the three blocks visible at a glance.
- **Do not add `// arrange` / `// act` / `// assert` captions.** The structure is already visible from the spacing and the setup → act → `expect` shape; labelling it is redundant noise that rots.
- **Test behavior, not internals.** Assert the observable output a consumer sees, not internal fields that happened to be set.
- When asserting multiple properties of one result, prefer a single `expect` over one `expect` per property. For a **partial** match use `toEqual(expect.objectContaining({ ... }))` — not `toStrictEqual`: when the argument is an asymmetric matcher, Jest only runs the matcher and the "strict" extra-property/undefined checks never fire, so `toStrictEqual` here is identical to `toEqual` but misleadingly implies strictness. Reserve `toStrictEqual` for **whole-object** assertions where you pass a concrete expected object and strictness actually applies.
- Cover all code paths including conditional branches, error handling, and boundary conditions.
- Use existing enums or constants instead of magic strings when those values exist in the codebase.
- Each test should exercise a unique code path — avoid redundant tests that only vary input without testing different behavior.

### Setup Factories

A setup factory encapsulates all arrangement for a unit and returns the locals each test needs. It configures any number of mocks in one call:

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

- **One factory configures any number of mocks** — a single factory call is the whole arrangement.
- **Variants come from parameters.** A test passes only the values it cares about.
- **A single explicit override is allowed** for the one variable a test varies:

  ```typescript
  const { userProfile, appSettings } = setupAvatar();
  mockGetAvatarFromProfile.mockReturnValue('https://cdn.example.com/p.png'); // the one thing this test changes
  ```

- **Cap factory sprawl.** If a scenario needs a substantially different arrangement, write a second named factory (`setupEmployee`, `setupContractor`) rather than over-parameterizing one mega-factory.

## Adding Mocks

### Mock Ordering

Jest hoists `jest.mock()` calls regardless of their position in the file. For consistency, place mock variable declarations and `jest.mock()` blocks **after** the `@jest/globals` import and after real imports from the module under test. This is the pattern in the vast majority of test files.

### Do NOT Mock Simple Constants

Never mock modules that only export plain constants (numbers, strings, static arrays/objects) with no side effects. Mocking them prevents coverage of the constant file and adds noise for no isolation benefit. Import the real module and let Jest execute it naturally.

Only mock a constant module if:
- It performs side effects at import time (e.g., reads from `localStorage`, makes network calls)
- You need to test behavior under a *different* value than the real constant provides

If you need to vary the constant's value per test, use `jest.replaceProperty` or restructure to inject the value rather than mocking the entire module.

### Mock Organization Strategy

Use a **hybrid approach** based on mock scope:

1. **Inline mocks** - Simple, one-off mocks specific to a single test file
2. **Co-located `__mocks__/` folder** - Module-specific mocks used by multiple tests in that area
3. **`test/mocks/`** - Global mocks used across the entire codebase (e.g., `mockDatabaseService`, `mockLogger`)

### Co-located `__mocks__/` Folder

When multiple tests need to mock the same module, create a `__mocks__` folder alongside the source:

```
src/events/
├── EventService.ts
├── EventService.unit.test.ts
└── __mocks__/
    └── EventService.ts        # Shared mock for EventService
```

### Mock Section Formatting

Use `// Mocked Imports` and `// -------------------------` separators to visually mark mock setup blocks at the top of the file. The `// Mocked Imports` header appears **once** at the start of the mock section. Each mock group (variable declarations + `jest.mock` call) is separated by `// -------------------------` lines:

**Single mock group:**

```typescript
// Mocked Imports
// -------------------------
const mockGetAdTagProps = jest.fn<(params: { tagId: string }) => IAdTagProps | null>();

jest.mock('@/framework/base/ad-tag/common/utils/ad-tag/get-ad-tag-props', () => ({
	getAdTagProps: (params: { tagId: string }) => mockGetAdTagProps(params),
}));
// -------------------------
```

**Multiple mock groups** -- each group is delimited by `// -------------------------` lines; the `// Mocked Imports` header is not repeated:

```typescript
// Mocked Imports
// -------------------------
const mockGetProfile = jest.fn<(params: { userId: string }) => Profile | null>();

jest.mock('@/utils/get-profile', () => ({
	getProfile: (params: { userId: string }) => mockGetProfile(params),
}));
// -------------------------
const mockGetAvatar = jest.fn<(params: { email: string }) => string | null>();

jest.mock('@/utils/get-avatar', () => ({
	getAvatar: (params: { email: string }) => mockGetAvatar(params),
}));
// -------------------------
```

### Inline Mocks

When your class/function under test imports a method from another file, and you need to manipulate its output, use `jest.mock` to override the import.

**Important**: Mock variables must have the word `mock` prepended. Jest hoists `jest.mock()` calls to the top of the file — only variables prefixed with `mock` are accessible inside the factory function.

Example setup:

```typescript
const mockGetAdTagProps = jest.fn<(params: { tagId: string }) => IAdTagProps | null>();

// The arrow wrapper delegates to the jest.fn() so we can
// control return values per-test via mockReturnValue.
jest.mock(
	'@/framework/base/ad-tag/common/utils/ad-tag/get-ad-tag-props',
	() => ({
		getAdTagProps: (params: { tagId: string }) => mockGetAdTagProps(params),
	}),
);
```

Set the mock's return value inside the unit's `setup()` factory — never in a `beforeEach`. With `clearMocks: true` in the Jest config (see [Mock Cleanup](#mock-cleanup)), call tracking resets automatically before each test, so no manual `mockClear()` is needed; the return value is re-set fresh by each test's `setup()` factory:

```typescript
const setupAdTag = ({ tagProps = null }: { tagProps?: IAdTagProps | null } = {}) => {
	mockGetAdTagProps.mockReturnValue(tagProps);
	// ...build and return the fixtures the test needs
};
```

### Mock Typing Rules

Every `jest.fn()` mock **must** be fully typed to match the real function's signature. Untyped or loosely typed mocks cause TypeScript errors that accumulate across the test suite. Follow these two rules:

**Rule 1: Type the `jest.fn<>()` generic to match the real function's full signature.**

Read the source file to find the real function's parameter and return types, then mirror them in the generic:

```typescript
// ❌ WRONG — omits parameters, causes TS2554/TS2345 on mockReturnValue/calledWith
const mockGetProfile = jest.fn<() => Profile | null>();

// ✅ CORRECT — matches the real function's signature
const mockGetProfile = jest.fn<(params: { userId: string }) => Profile | null>();
```

For zero-parameter functions, `jest.fn<() => ReturnType>()` is correct. For async functions, include the Promise wrapper: `jest.fn<(id: string) => Promise<User>>()`.

**Rule 2: Use typed parameters in mock factory wrappers — never `(...args: unknown[])`.**

The `(...args: unknown[]) => mockFn(...args)` pattern causes TS2556 ("A spread argument must either have a tuple type or be passed to a rest parameter"). Instead, write a wrapper whose parameters match the real function:

```typescript
// ❌ WRONG — causes TS2556
jest.mock('@/utils/get-profile', () => ({
	getProfile: (...args: unknown[]) => mockGetProfile(...args),
}));

// ✅ CORRECT — typed parameters
jest.mock('@/utils/get-profile', () => ({
	getProfile: (params: { userId: string }) => mockGetProfile(params),
}));
```

**Always check the source function's signature before choosing the wrapper pattern.** For zero-parameter functions, use `() => mockFn()`. For functions with parameters, list each parameter with its type. Using `() => mockFn()` for a function that takes parameters silently discards arguments — the `jest.fn()` spy will record zero arguments on every call, causing `toHaveBeenCalledWith` assertions to fail.

**Note:** Some existing test files use `(...args: unknown[]) => mockFn(...args)` — this is legacy debt being migrated. New tests must always use typed parameters as shown above.

### Global Test Utilities

When mocks or fixtures are shared across many test files, place them in a dedicated `test/` folder at the package root. Use this structure for new shared utilities:

```
packages/your-package/
├── src/
│   └── ...
└── test/
    ├── mocks/           # Shared mocks (e.g., mockDatabaseService)
    ├── fixtures/        # Test data factories
    └── utils/           # Test helpers
```

## Async Testing

Configure async mocks with `mockResolvedValue` / `mockRejectedValue` in the setup factory. The act is `await`ed in the test. Assert rejected promises with `expect().rejects`.

```typescript
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
		setupUserData({ error: new Error('Not found') });

		await expect(getUserData({ userId: '999' })).rejects.toThrow('Not found');
	});
});
```

The error case is the one place the act sits inside the assertion (`expect(...).rejects`) — its rejection must be caught by the matcher.

## Testing Hooks

To test a Preact/React hook in isolation, mock the framework's hook primitives with synchronous shims so the hook body executes immediately without a component render cycle. Capture effect callbacks so tests can invoke them and assert side effects.

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
```

Wire the hook call into a `setup()` factory, then invoke the captured effect callback in the test to trigger side effects:

```typescript
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

## Module Isolation with `jest.isolateModules`

Use `jest.isolateModules` when testing code that has side effects at import time (e.g., reads `document.currentScript`, checks `document.readyState`). Each call gets a fresh module instance, so per-test DOM state changes take effect on the next import.

```typescript
const setupAutoInit = ({ autoInit }: { autoInit: 'true' | 'false' }) => {
	const mockScript = document.createElement('script');
	mockScript.dataset.autoInit = autoInit;

	Object.defineProperty(document, 'currentScript', {
		value: mockScript,
		writable: true,
		configurable: true,
	});
};

describe('autoInitInBrowser', () => {
	test('does not instantiate Widget when auto-init is disabled', () => {
		setupAutoInit({ autoInit: 'false' });

		jest.isolateModules(() => {
			require('./autoInitInBrowser').autoInitInBrowser();
		});

		expect(mockWidgetConstructor).not.toHaveBeenCalled();
	});
});
```

Use `jest.isolateModules` instead of standard imports when the module's behavior depends on global state that varies per test case.

## Environment-Specific Branches

Some code has branches that depend on the runtime environment (e.g., `typeof window === 'undefined'` for SSR guards). These branches can't be reached in the default `jsdom` test environment.

To test them, create a **separate test file** with a Jest environment docblock at the top:

```typescript
/**
 * @jest-environment node
 */
import { expect, describe, test } from '@jest/globals';
import { autoInitInBrowser } from '@modules/init/autoInitInBrowser';

describe('autoInitInBrowser', () => {
	test('returns early without mounting in a non-browser environment', () => {
		const result = autoInitInBrowser();

		expect(result).toBeUndefined();
	});
});
```

Name the file with a suffix that distinguishes it from the main test: e.g., `autoInitInBrowser.ssr.unit.test.ts`. This keeps the main jsdom tests in one file and the node-environment tests in another.

## Parameterized Tests

Use `test.each` when multiple inputs exercise the **same code path** with different expected outputs. When different inputs exercise **different code paths**, use separate tests instead.

```typescript
describe('formatCurrency', () => {
	test.each([
		{ amount: 100, locale: 'en-US', expected: '$1.00' },
		{ amount: 100, locale: 'en-GB', expected: '£1.00' },
		{ amount: 0, locale: 'en-US', expected: '$0.00' },
	])(
		'formats $amount in $locale as $expected',
		({ amount, locale, expected }) => {
			const formatted = formatCurrency({ amount, locale });

			expect(formatted).toBe(expected);
		},
	);
});
```

## Method-Level Mocking with `jest.spyOn`

Use `jest.spyOn` when you need to mock a single method on an already-instantiated object rather than replacing an entire module. This is common when dependencies are injected instances you already hold a reference to.

Prefer `jest.spyOn` over `jest.mock` when:
- The target is a method on an object you already have a reference to (e.g., an injected service or repository)
- You want to mock one method while leaving the rest of the object intact

Prefer `jest.mock` (module-level) when:
- The target is a standalone exported function from another module
- You need to replace the entire module before it's imported

```typescript
const setupUserUpdate = ({ user }: { user: User }) => {
	const mockUpdate = jest.spyOn(userRepository, 'update').mockResolvedValue(user);

	return { mockUpdate };
};

describe('updateUser', () => {
	test('calls the repository with the correct args', async () => {
		const { mockUpdate } = setupUserUpdate({ user: mockUser });

		await updateUser({ id: 'user-1', name: 'Updated' });

		expect(mockUpdate).toHaveBeenCalledWith({
			where: { id: 'user-1' },
			data: { name: 'Updated' },
		});
	});
});
```

Asserting the repository was called with the right args is testing *behavior* here, not internals: the persistence call is this unit's observable side effect at its boundary, so the call itself is the output a consumer relies on.

With `restoreMocks: true` in the Jest config (see [Mock Cleanup](#mock-cleanup)), spies are restored automatically before each test — no manual `mockRestore()` needed.

## Mock Cleanup

Mock cleanup is handled by **Jest config, not per-test code**. Set these in the package's Jest config:

```javascript
// jest.config.js / jest.config.ts
{
	clearMocks: true,    // clear call tracking (calls, instances, results) before each test
	restoreMocks: true,  // restore jest.spyOn originals before each test
}
```

With these set, every mock starts each test with clean call tracking and its `setup()` factory wires the return value fresh. Do **not** add manual `mockClear()` calls or a cleanup `beforeEach` — the config does it.

- **`clearMocks: true`** — clears `calls`, `instances`, `contexts`, and `results` before each test (equivalent to `jest.clearAllMocks()`). It does **not** clear `mockReturnValue` / `mockImplementation` — that is `resetMocks`. Because every test re-sets its return values in `setup()`, `clearMocks` is sufficient and avoids wiping implementations; reach for `resetMocks` only if a package genuinely needs return values auto-cleared.
- **`restoreMocks: true`** — additionally restores the original implementation of every `jest.spyOn` before each test (it does not affect standalone `jest.fn()` return values).

**If the package's Jest config lacks these:** add them. But `clearMocks` changes behavior for **every existing test in the package** — any test relying on a mock set once in `beforeAll` (expecting it to persist across tests) will break. After adding, run the package's full `test:unit`; if pre-existing tests fail, **flag it in your report** rather than mass-editing legacy tests.

## Running Tests

Every package defines a `test:unit` script.

For a single-package repo, run all unit tests with:

```bash
pnpm test:unit
```

For a monorepo, scope to a specific package with `--filter`:

```bash
pnpm --filter <package-name> test:unit
```

To discover available package filter names, run `pnpm ls --json --depth -1` and match the directory to its `name` field.

To run a single test file, append `-- <path>`:

```bash
pnpm test:unit -- <relative-path-to-test-file>
```

To collect coverage for a single file under test, add `--coverage --collectCoverageFrom`:

```bash
pnpm test:unit -- --coverage --collectCoverageFrom='<relative-path-to-source-file>' <relative-path-to-test-file>
```
