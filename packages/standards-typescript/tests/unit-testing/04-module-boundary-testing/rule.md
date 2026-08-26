---
summary: "coverage added file-by-file when driving the module's public API would pin the same behavior — boundary tests are the default, not the mandate"
checked: false
severity: advisory
---

## Module Boundary Testing

**Default to testing a module's public API** — the exports its barrel
(`index.ts`) publishes — and cover internals *through* it. A boundary test pins
behavior rather than internal decomposition, so a module's internals can be
reorganized without touching a single test, and three code changes inside a
module cost one test update instead of three.

**A direct test on any file is allowed** when the file earns one:

- its cases are combinatorial and driving them all through the boundary is
  impractical
- it states a contract meaningful on its own (a parser, a date formatter — a
  thing callers rely on regardless of which module holds it today)
- coverage a gate demands is genuinely unreachable through any boundary input
  (and first ask whether that unreachable branch is dead code)

A direct test needs no ceremony: it does not require promoting the file into
the barrel, and an existing direct test is not debt to migrate. Write the
boundary test when both would pin the same behavior; write the direct test when
the file deserves one.

**Rules that hold either way:**

- Files with no runtime logic — barrels, type-only files, pure constants —
  get no dedicated tests (see the files-that-must-not-have-dedicated-tests
  rule).
- If a branch cannot be reached through any input, boundary or direct, it is
  dead code — flag it for deletion rather than forcing a test onto it.
- A barrel entry whose only consumers are test files is legitimate public
  API — a deliberate promotion whose contract the tests pin; demoting it is a
  human decision.
