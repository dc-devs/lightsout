---
summary: "a second convention introduced into a domain that already standardized on one"
checked: false
severity: advisory
---

## Naming Consistency

Standardize patterns within each domain — if the codebase already uses one, follow it; never introduce a competing convention:

- Data fetching: one of `getData` / `fetchData` / `loadData`, not a mix
- Booleans: consistent prefixes (`is`, `has`, `should`, `can`)
- Event handlers: one pattern (`onSubmit` vs `handleSubmit`)

Subordinate to Naming Consistency above: a domain that already standardized on `fetchData` keeps its verb — the vocabulary governs new domains.
