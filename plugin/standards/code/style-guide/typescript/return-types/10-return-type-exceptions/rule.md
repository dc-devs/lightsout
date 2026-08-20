---
summary: "an annotation written where inference is the contract — a component, a generic signature, an interface-pinned method, a query-options factory"
checked: false
severity: advisory
---

**Exceptions** (inference is correct on these even when exported):

1. **Framework components** — React components don't annotate `JSX.Element`.
2. **Generic-heavy signatures** — when the written return type would be an unreadable conditional-type expression, the generic signature is the contract; infer.
3. **Interface-pinned signatures** — methods implementing a declared interface (e.g., a `RecordSource` implementation) are already contracted by the interface; restating the type is duplication.
4. **TanStack query-options factories under a `queries/` folder** — the inferred `queryOptions` type is the contract, and it carries the key and data types a hand-written annotation would flatten; infer.
