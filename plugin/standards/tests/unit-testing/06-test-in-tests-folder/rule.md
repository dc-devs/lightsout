---
summary: "a unit test in a separate tests directory instead of beside its subject"
checked: true
severity: advisory
---

## Test Files

- A unit test sits **beside** its source file: `src/auth/AuthService.ts` → `src/auth/AuthService.unit.test.ts`.
- **Scenario suites**: when one boundary genuinely needs more than one test
  file (a pipeline with distinct monorepo/nested/park scenarios), qualify the
  name — `<File>.<scenario>.unit.test.ts`, e.g.
  `runImplementPipeline.monorepo.unit.test.ts`. The first segment must name a
  real source file in the folder; the qualifier is camelCase. A test file
  whose subjects span several source files is a split candidate, not a naming
  exception — one subject per test file.
- **A test imports its subject from the subject's own file**: a test beside its
  source imports the file it tests (`./AuthService`), never an index file
  (`./index`) — an import through one loads every file it re-exports to reach
  one name. A test inside a module may import that module's other files too;
  a test outside it imports only the module's public files, as any other
  caller would.
- **Shared test helpers, mocks, and fixtures live outside `src/`** in the package's test-support directories (`tests/helpers/`, `test/mocks/`, `test/fixtures/`, a `__mocks__/` folder beside the module it doubles); only test files themselves sit beside their source. Test-support code under `src/` would read as production source — to scanners and humans alike.
- First import: `import { expect, describe, test, jest } from '@jest/globals';` — but include `jest` only when the file actually uses `jest.fn`/`jest.mock`/`jest.spyOn`, and import `beforeEach`/`afterEach`/`afterAll` only when genuinely needed (with setup factories and config-level mock cleanup, most files need none). An unused import fails `noUnusedLocals`/lint.
- The first `describe` matches the name of the class or function under test. Keep `describe` blocks **flat** — scenario variants come from `setup()` parameters, not nested `describe` + `beforeEach` pyramids. When you do nest, prefix with `when ...` (condition) or `for ...` (variant).

Test files live adjacent to the file they test — never in separate `__tests__/` directories.
