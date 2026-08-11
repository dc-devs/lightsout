---
summary: "an annotation written where inference is the contract — a component, a generic signature, an interface-pinned method"
checked: false
severity: advisory
---

**Exceptions** (inference is correct on these even when exported):

1. **Framework components** — React components don't annotate `JSX.Element`.
2. **Generic-heavy signatures** — when the written return type would be an unreadable conditional-type expression, the generic signature is the contract; infer.
3. **Interface-pinned signatures** — methods implementing a declared interface (e.g., a `RecordSource` implementation) are already contracted by the interface; restating the type is duplication.
