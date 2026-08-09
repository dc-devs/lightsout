---
summary: "these standards describe the tests you write, not a mandate to renovate the ones already there"
checked: false
severity: advisory
---

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
