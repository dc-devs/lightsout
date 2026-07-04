# Unit Testing

## Precedence in Repos with Older Tests

These standards describe the target style for tests you WRITE, not a mandate
to renovate tests that exist. When the repo's existing tests predate this
document and use another style (`beforeEach` + shared `let`, nested
`describe` pyramids):

- **Extending an existing test file** → match that file's local style. One
  file, one style — never mix a second convention into a file.
- **Creating a new test file** → this document wins, even when your mirror
  target uses the older style. Mirror the target's coverage, not its
  structure.
- Never rewrite passing legacy tests to match this document during a
  feature task — that is deliberate cleanup work with its own review, not a
  side effect.
- Applying this precedence is **normal operation, not friction** — do not
  record a friction entry per legacy-style file you encounter. Record ONE
  friction entry only when the rule itself failed you: the conflict was not
  stylistic, or it was genuinely ambiguous which case applied.

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

## Test Files

- Unit tests are **co-located** with their source file: `src/auth/AuthService.ts` → `src/auth/AuthService.unit.test.ts`.
- First import: `import { expect, describe, test, jest } from '@jest/globals';` — but include `jest` only when the file actually uses `jest.fn`/`jest.mock`/`jest.spyOn`, and import `beforeEach`/`afterEach`/`afterAll` only when genuinely needed (with setup factories and config-level mock cleanup, most files need none). An unused import fails `noUnusedLocals`/lint.
- The first `describe` matches the name of the class or function under test. Keep `describe` blocks **flat** — scenario variants come from `setup()` parameters, not nested `describe` + `beforeEach` pyramids. When you do nest, prefix with `when ...` (condition) or `for ...` (variant).

## Files That Must NOT Have Dedicated Tests

Do **not** create test files for source files with no runtime logic — they are covered when consumed:

- **Pure constants** — only literal values, no computation or side effects
- **Enums with no computed members** / string-union types
- **Type-only files** — only `type`/`interface` declarations
- **Barrel / re-export files** (`index.ts`)

A file qualifies for testing only when it contains **executable logic**. If a constant file *does* contain logic (e.g., env-var fallback), test the logic paths — not the static value.

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

- **Arrange in a `setup()` factory.** The factory wires mocks and builds fixtures, then returns the locals the test needs as `const`s. Do **not** hold the subject under test in a shared `let` reassigned across `beforeEach` blocks — that is mutable test state.
- **Act and assert live in the `test`**, not in `beforeEach`. (Component tests are the one accepted exception: `render()` lives in the `setup()` factory by convention — see the component testing doc.)
- **One `setup()` and one act per test.** Two setups or two acts means two tests. Multiple `expect`s are fine only when they assert one behavior's result.
- **No nested method calls in the act.** Assign each call's result to a named `const`. Two exceptions: (1) the error case, where the act sits inside the matcher: `expect(() => parse(bad)).toThrow()`; (2) assertion-matcher composition (`toEqual(expect.objectContaining(...))`).
- **Blank line between arrange, act, and assert** — and no `// arrange` / `// act` / `// assert` captions; the spacing already shows the structure.
- **Test behavior, not internals.** Assert the observable output a consumer sees. (Asserting an injected repository was called with the right args IS behavior — the persistence call is the unit's observable side effect at its boundary.)
- When asserting multiple properties of one result, prefer a single `expect`. For a **partial** match use `toEqual(expect.objectContaining({ ... }))` — not `toStrictEqual`: with an asymmetric matcher argument, Jest only runs the matcher and the strict extra-property checks never fire, so `toStrictEqual` there is identical to `toEqual` but misleadingly implies strictness. Reserve `toStrictEqual` for whole-object assertions with a concrete expected object.
- Cover all code paths — branches, error handling, boundary conditions. Each test exercises a unique code path; don't add tests that only vary input without varying behavior.
- **Reaching defensive branches:** when a branch guards against input the type system forbids (a `default` arm, an early return on an impossible discriminant), a test may force the invalid input with `as unknown as T` — the one blessed double cast, and it lives only in test files, never in source.
- Use `test.each` when multiple inputs exercise the **same code path** with different outputs; different code paths get separate tests.

### Assertions Pin Contracts

- **Assert with literals — never import a constant from the module under test into its own assertions.** A test comparing `x` to `x` is a tautology that passes even when the value is wrong; the literal in the test is the independent second statement of the contract. (Duplication between a source constant and its test literal is contract-pinning, not a DRY violation.) Constants from *other* modules — shared enums the codebase already defines — are fine as inputs.
- **Pin machine-facing values strictly, human-facing copy loosely.** Error codes, event names, and API fields get exact assertions; UI copy and log messages get `stringContaining`/regex or no assertion at all — wording changes shouldn't fail contract tests.
- **Construct the subject under test directly; stub only unowned boundaries** (network, filesystem, other modules' services). Don't mock what you own and could simply instantiate.
- **Prefer behavior assertions over property echoes** — assert what the unit *does* (output, side effect at its boundary), not that a value passed in reappears unchanged.

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

- **One factory configures any number of mocks** — a single factory call is the whole arrangement; variants come from parameters.
- **A single explicit override is allowed** for the one variable a test varies (`setupAvatar()` then one `mockReturnValue` line).
- **Cap factory sprawl.** A substantially different arrangement gets a second named factory (`setupEmployee`), not an over-parameterized mega-factory.

## Mocks

- Place mock declarations and `jest.mock()` blocks after the imports, marked with a `// Mocked Imports` header and `// -------------------------` separators between groups (mirror any existing test file's formatting).
- **Mock variables must be prefixed `mock`** — Jest hoists `jest.mock()` calls to the top of the file, and only `mock`-prefixed variables are accessible inside the factory.
- Set mock return values inside the `setup()` factory — never in a `beforeEach`.
- **Do NOT mock modules that only export plain constants** — import the real module; mocking it blocks coverage and adds no isolation. Mock a constant module only if it has import-time side effects or the test needs a *different* value (prefer `jest.replaceProperty` or injection).
- Scope strategy: inline mocks for one file; a co-located `__mocks__/` folder when multiple tests in the area share a mock; `test/mocks/` (with `test/fixtures/`, `test/utils/`) for codebase-wide utilities.

### Mock Typing Rules

Every `jest.fn()` **must** be fully typed to the real function's signature — read the source first.

```typescript
// ✅ generic matches the real signature (async: include the Promise wrapper)
const mockGetProfile = jest.fn<(params: { userId: string }) => Profile | null>();

// ✅ factory wrapper uses typed parameters — never (...args: unknown[]) (causes TS2556)
jest.mock('@/utils/get-profile', () => ({
	getProfile: (params: { userId: string }) => mockGetProfile(params),
}));
```

Using `() => mockFn()` for a function that takes parameters silently discards arguments — the spy records zero-arg calls and `toHaveBeenCalledWith` fails. Some existing files use `(...args: unknown[])` — that is legacy debt; new tests always type the wrapper.

**Framework-generic results are exempt.** These typing rules pin *your* contracts, not the framework's. When a stub must satisfy a framework's heavily generic result type (TanStack's `UseMutationResult` / `UseQueryResult` and kin), stub only the fields the unit under test reads and cast loosely (`as Record<string, unknown>`, or `as unknown as UseMutationResult<…>` where the full type is demanded) — reproducing the framework's generics in a stub adds noise, not safety.

### `jest.spyOn` vs `jest.mock`

- Prefer **`jest.spyOn`** for a single method on an object you already hold (an injected service/repository), leaving the rest intact.
- Prefer **`jest.mock`** for a standalone exported function from another module.

### Async

Configure with `mockResolvedValue` / `mockRejectedValue` in the setup factory; `await` the act in the test; assert rejections with `await expect(...).rejects.toThrow(...)` — the one place the act sits inside the assertion.

### Import-Time Side Effects

- Use **`jest.isolateModules`** when the module acts at import time (reads `document.currentScript`, checks globals): each call gets a fresh module instance, so per-test state changes take effect on the next require inside the isolate block.
- Branches unreachable in the default `jsdom` environment (e.g., SSR guards on `typeof window`) get a **separate test file** with a `/** @jest-environment node */` docblock, named to distinguish it (`autoInitInBrowser.ssr.unit.test.ts`).

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

**If the package's Jest config lacks these: do NOT add them.** `clearMocks` changes behavior for **every existing test in the package** — any test relying on a mock set once at module scope or in `beforeAll` will break (live example: adding it to a real package broke 22 import-time-construction tests). A repo-wide behavior change is a human's decision, not a test task's side effect. Instead:

- Build **fresh `jest.fn()` mocks inside each `setup()` factory call** (and construct a fresh subject per call), so call tracking cannot accumulate across tests without any config or hooks.
- For module-level mocks that must persist (a `jest.mock` factory), reset them at the top of `setup()` (`.mockReset()` + re-wire), or assert only with `toHaveBeenCalledWith` — positive assertions are unaffected by accumulated calls; avoid `not.toHaveBeenCalled` on shared mocks.
- Record the missing config as friction (`area: "environment"`) so the repo owner can adopt it deliberately.
