---
summary: "an incoming string cast into the union at a boundary instead of validated into it"
checked: false
severity: advisory
---

## Boundaries

At boundaries (JSON payloads, query params, DB values) incoming strings are not yet the union — convert with a small validation function (e.g., `parseAction`), never with an `as` cast.
