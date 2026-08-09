# Test-shape examples

Deliberately-wrong (and deliberately-right) test files, read by
`src/standardsCheck/checkTestShape.unit.test.ts` and its `.mocks.` and
`.edges.` siblings. In `structure/` and `mocks/`, each file violates exactly
one rule of `standards/tests/unit/jest/unit-testing.md`, or pins exactly one of
that rule's exceptions. `edges/` holds what one file per rule cannot show: one
rule broken twice in a file, two rules broken in one file, a brace hidden
inside a string, a test named with `it`, one rule broken in two different
hooks, a factory sitting just inside a rule's documented blind spot, and a
source file carrying the same code a test file would be flagged for. The tests point `runStandardsCheck` at
one of the three folders as if it were a repo, then filter the findings by file
and rule.

These are real files rather than strings typed inside a test on purpose:
`checkTestShape` is the first pass that ever opens test files, so a bad example
written as a string would still sit inside a real test file and be read as a
genuine violation of it.

## Four exclusions make that safe, and every one is load-bearing

- **The standards check skips this folder.** `listSourceFiles` skips any
  directory whose name starts with a dot, so a whole-repo run never reports
  these files. A run whose `cwd` IS `structure/`, `mocks/` or `edges/` walks
  them normally, because the walk only skips a dot-name it meets as an entry.
- **TypeScript skips it.** `tsconfig.json` includes `src/**`, `tests/**` and
  `tools/**` only. Nothing here reaches `pnpm check`, so a fixture may be as
  wrong as its rule requires.
- **Both Jest configs skip it.** The unit config matches
  `src/**/*.unit.test.ts` and the end-to-end config matches
  `tests/**/*.test.ts`. Neither reaches `fixtures/`. A dot-folder under
  `tests/` would NOT work: that glob does descend into dot-directories, so
  fixtures there would run as real suites.
- **`isTestFile` still claims them.** The predicate matches on a `.test.`
  segment, so these land in the test-file list `checkTestShape` consumes —
  which is the whole point.

Nothing here is meant to pass if executed. Do not add these paths to a Jest
config, a tsconfig, or the lint setup.
