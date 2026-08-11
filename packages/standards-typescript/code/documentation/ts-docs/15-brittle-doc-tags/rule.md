---
summary: "a doc comment carrying a tag git, TypeScript or the issue tracker already owns"
checked: true
severity: advisory
---

## Brittle Tags — Do NOT Use

`@version` / `@since` / `@author` (git owns these) · `@type` / `@default` / `@readonly` / `@private` / `@public` / `@protected` / `@memberof` (TypeScript owns these) · `@see` with URLs (use `@see {@link SymbolName}` instead) · `@todo` (issue tracker) · `@deprecated` without a migration path.
