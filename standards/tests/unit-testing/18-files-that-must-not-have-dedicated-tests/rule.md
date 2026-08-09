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
- **Barrel / re-export files** (`index.ts`)

A file qualifies for testing only when it contains **executable logic**. If a constant file *does* contain logic (e.g., env-var fallback), test the logic paths — not the static value.
