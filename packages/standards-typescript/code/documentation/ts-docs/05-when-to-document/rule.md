---
summary: "a doc comment on an export whose name and types already say it, or an inline comment narrating the next line"
checked: false
severity: advisory
---

## When to Document

Default to self-documenting code. Add JSDoc only when:

- The **why** is non-obvious — business context, constraints, or gotchas a reader wouldn't guess from the code.
- The function has a **complex contract** — non-obvious parameter interactions, intentional error-throwing behavior, usage worth an example.
- The export is a **public API boundary** consumed by other packages or external callers.

If the name and types already communicate the purpose, skip the comment.

**Inline `//` comments:** default to none. Use only for a non-obvious workaround, a business rule embedded in logic (`// 30-day window per billing agreement`), or a deliberate deviation and why. Never narrate what the next line does.
