---
summary: "a named constant in camelCase, or a lone value constant in PascalCase"
checked: false
severity: advisory
---

## Casing

Named constants are **PascalCase** (`Action`, `LogLevel`) — the `const` object and its derived `type` share one name, and the type must be PascalCase. The file matches: `Action.ts`.

This is distinct from plain **value constants** (a single scalar or config value like `maxRetries`, `emailRegex`), which stay **camelCase**. The test: if it backs a union or has members consumers dot into (`Action.Add`), it's a named constant → PascalCase; if it's a lone value, it's a value constant → camelCase.
