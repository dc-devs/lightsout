---
summary: "a module-scope mock variable without the `mock` prefix Jest hoisting needs"
checked: true
severity: blocking
---

## Mocks

- Place mock declarations and `jest.mock()` blocks after the imports, marked with a `// Mocked Imports` header and `// -------------------------` separators between groups (mirror any existing test file's formatting).
- **Mock variables must be prefixed `mock`** — Jest hoists `jest.mock()` calls to the top of the file, and only `mock`-prefixed variables are accessible inside the factory.
- Set mock return values inside the `setup()` factory — never in a `beforeEach`.
- **Do NOT mock modules that only export plain constants** — import the real module; mocking it blocks coverage and adds no isolation. Mock a constant module only if it has import-time side effects or the test needs a *different* value (prefer `jest.replaceProperty` or injection).
- Scope strategy: inline mocks for one file; a co-located `__mocks__/` folder when multiple tests in the area share a mock; `test/mocks/` (with `test/fixtures/`, `test/utils/`) for codebase-wide utilities.
