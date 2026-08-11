---
summary: "a domain value claiming the props exemption while it also appears in domain logic"
checked: false
severity: advisory
---

**Exemption — component prop unions.** A UI component's discriminated `Props` union may use raw string-literal discriminants (`status: 'notInstalled' | 'connected'`): the caller writes the literal once as a JSX attribute, which is idiomatic React and reads better than a constant import. The rule above targets domain values that cross module boundaries and get narrowed at many call sites. If the same discriminant values also appear in domain logic, they are domain values — use the `const` object everywhere, props included.
