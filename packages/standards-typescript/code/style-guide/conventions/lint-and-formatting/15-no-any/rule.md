---
summary: "an `any` annotation with no lint-suppression comment licensing it"
checked: true
severity: blocking
---

**No `any`** — use `unknown` and narrow with type guards when the type is genuinely unknown; use specific types or generics when it isn't. A rare, justified bypass gets the project's lint-suppression comment with an explanation.
