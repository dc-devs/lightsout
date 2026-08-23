---
summary: "an import used only in type positions declared without `import type`"
checked: true
severity: blocking
---

**The lint preset is binding even where the repo's lint config does not yet enforce it.** These rules are mechanical — they are stated here once, without prose, and violations are violations whether or not a linter catches them:

- **`import type` for type-only imports** — anything used only in type positions (annotations, parameter types, generic arguments) imports with `import type`, so it erases at compile time.
