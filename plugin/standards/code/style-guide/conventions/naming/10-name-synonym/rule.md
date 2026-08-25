---
summary: "two exports that name the same concept with different verbs — `getUser` beside `fetchUser` is usually the same code written twice"
checked: true
severity: advisory
---

## One Concept, One Verb

Before writing new code, agents and humans both search the repo by name. When
one concept already lives under `getUserData` and someone searches for
"fetchUserData", the search finds nothing — so they write it again. The
duplicate detectors that compare code bodies cannot catch this: the two
implementations were written independently and look nothing alike. The name is
the only evidence.

So: **never introduce a second verb for a concept that already has a name.**
If the codebase has `getUserData`, the new reader is `getUserSettings`, not
`fetchUserSettings`. The check flags export names that differ only by synonym
(`fetch`/`load`/`retrieve`/`read` ≈ `get`, `make`/`generate`/`produce` ≈
`create`, `remove` ≈ `delete`, `modify` ≈ `update`, `verify`/`check` ≈
`validate`) or by word order.

A name standing alone may use any verb it likes — `readFile`, `loadConfig` and
`checkArgs` are idiomatic and fine. The rule is about pairs, not vocabulary:
it fires only when two living names collide on one concept.

A domain that already standardized on another verb keeps it — consistency with
the neighbors outranks this rule (see Naming Consistency above), which is why
the finding is advisory: some pairs are deliberate.
