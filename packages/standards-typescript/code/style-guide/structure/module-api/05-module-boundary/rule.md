---
summary: "a file deep-imported across a module boundary instead of through its barrel"
checked: true
severity: blocking
---

## Module Boundaries

A **folder-module** (feature, route, screen, graduated class or component — see [architecture-decisions.md](../../architecture/architecture-decisions.md#modules--the-graduation-rule)) has a public API: its `index.ts`.

- **Crossing a module boundary:** import ONLY from the module's `index.ts` — never reach into another module's internals (`@/ingestion`, not `@/ingestion/common/utils/normalizeRecord`).
- **Inside a module:** import directly from specific files — deep imports within your own module are correct.
