---
summary: "a relative import path in a package that configures aliases"
checked: true
severity: blocking
---

**Use the package's configured path alias for every import.**

- When a package defines path aliases, NEVER use relative paths (`./`, `../`) — not even for sibling files, `common/` subfolders, or barrel re-exports
- If a package defines **no** path aliases, use relative paths consistently — and consider adding aliases
- This applies to every file: components, constants, interfaces, types, utils, hooks, etc.
