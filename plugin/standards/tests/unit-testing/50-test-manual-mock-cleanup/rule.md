---
summary: "manual mock cleanup in a lifecycle hook, which the Jest config already does"
checked: true
severity: blocking
---

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
