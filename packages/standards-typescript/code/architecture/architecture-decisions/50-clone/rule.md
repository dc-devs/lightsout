---
summary: "token-level copy-paste spans"
checked: true
severity: advisory
settings:
  minTokens: 50
---

### Duplicated Patterns & Logic

The same pattern in 2+ files gets extracted to the lowest common ancestor `common/` (loading/error state handling, validation logic, repeated transformations, generic named constants like a `SortDirection` union belong in `src/common/constants/`).
