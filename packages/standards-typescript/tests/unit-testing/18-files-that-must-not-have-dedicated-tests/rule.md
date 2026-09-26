---
summary: "a dedicated test file on a source file that holds no runtime logic"
checked: false
severity: advisory
---

## Files That Must NOT Have Dedicated Tests

Do **not** create test files for source files with no runtime logic — they are covered when consumed:

- **Pure constants** — only literal values, no computation or side effects
- **Enums with no computed members** / string-union types
- **Type-only files** — only `type`/`interface` declarations
- **Index files** (`index.ts`) — a list of re-exports; code imports the files it lists, never the index file

A file qualifies for testing only when it contains **executable logic**. If a constant file *does* contain logic (e.g., env-var fallback), test the logic paths — not the static value.

### Exception — a package's published entry

The `index.ts` a package names in its `exports` map is the one index file that is
**not** covered when consumed, because nothing inside the repo consumes it. It is
the contract with the outside world: a name dropped from it in a rename or a
merge breaks every downstream build while every other test in the suite keeps
passing.

A dedicated test on that file may pin only what no other test can reach:

- the exact set of exported names
- that each one arrived as a value rather than erasing to `undefined`

It must not re-prove what the exported things do — that belongs to each one's own
test file.
