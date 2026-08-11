---
summary: "a file that exists only to alias another type"
checked: false
severity: advisory
---

### Type Alias Indirection

Don't create a file just to alias another type (`export type FilterOptions = TableFilterState`) — use the original directly; if the semantic distinction matters, a comment at the usage site beats indirection.
