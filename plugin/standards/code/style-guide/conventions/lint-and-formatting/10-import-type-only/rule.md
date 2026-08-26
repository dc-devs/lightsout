---
summary: "an import used only in type positions declared without `import type`"
checked: true
severity: blocking
---

**The lint preset is binding even where the repo's lint config does not yet enforce it.** These rules are mechanical — they are stated here once, without prose, and violations are violations whether or not a linter catches them:

- **`import type` for type-only imports** — anything used only in type positions (annotations, parameter types, generic arguments) imports with `import type`, so it erases at compile time. On a decorated declaration — a decorated class's constructor parameters, a decorated method's parameters, a decorated property's type — the referenced names are runtime values (decorator metadata is how DI and validation read them), so they are imported as values; `import type` there is the bug, not the fix.
