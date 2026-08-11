---
summary: "a unit test in a separate tests directory instead of beside its subject"
checked: true
severity: blocking
---

## Test Files

- Unit tests are **co-located** with their source file: `src/auth/AuthService.ts` → `src/auth/AuthService.unit.test.ts`.
- **Scenario suites**: when one boundary genuinely needs more than one test
  file (a pipeline with distinct monorepo/nested/park scenarios), qualify the
  name — `<File>.<scenario>.unit.test.ts`, e.g.
  `runImplementPipeline.monorepo.unit.test.ts`. The first segment must name a
  real source file in the folder; the qualifier is camelCase. A test file
  whose subjects span several source files is a split candidate, not a naming
  exception — one subject per test file.
- **Tests are clients, not module members**: a co-located test imports its
  own module through the module's barrel (`./index`), exactly like an outside
  consumer, and never deep-imports a sibling internal. A barrel entry whose
  only consumers are test files is legitimate public API — it marks a
  deliberate promotion whose contract the tests pin; demoting it is a human
  decision, not a dead-code cleanup.
- **Shared test helpers, mocks, and fixtures live outside `src/`** in the package's test-support directories (`tests/helpers/`, `test/mocks/`, `test/fixtures/`, co-located `__mocks__/`); only test files themselves co-locate. Test-support code under `src/` would read as production source — to scanners and humans alike.
- First import: `import { expect, describe, test, jest } from '@jest/globals';` — but include `jest` only when the file actually uses `jest.fn`/`jest.mock`/`jest.spyOn`, and import `beforeEach`/`afterEach`/`afterAll` only when genuinely needed (with setup factories and config-level mock cleanup, most files need none). An unused import fails `noUnusedLocals`/lint.
- The first `describe` matches the name of the class or function under test. Keep `describe` blocks **flat** — scenario variants come from `setup()` parameters, not nested `describe` + `beforeEach` pyramids. When you do nest, prefix with `when ...` (condition) or `for ...` (variant).
