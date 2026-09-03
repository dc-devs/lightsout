---
summary: "a file deep-imported across a module boundary instead of through its barrel"
checked: true
severity: advisory
---

## Module Boundaries

A **folder-module** (feature, route, screen, graduated class or component — see [architecture-decisions.md](../../architecture/architecture-decisions.md#modules--the-graduation-rule)) has a public API: its `index.ts`.

- **Crossing a module boundary:** import ONLY from the module's `index.ts` — never reach into another module's internals (`@/ingestion`, not `@/ingestion/common/utils/normalizeRecord`).
- **Inside a module:** import directly from specific files — deep imports within your own module are correct.

A folder the package's framework mandates as a module — a TanStack Start screen under `features/*/screens/*` — is a boundary whatever the barrel-omission test says; the mandate, not the concealment, is what declares it.

Module boundaries are a package's own architecture, so this rule judges only a file that belongs to a package. Where the repo's manifests declare workspace packages, a file outside every one of them — a build script at the repo root, say — belongs to no package's architecture and is not held to this rule. A repo whose manifests declare no workspace package is itself one package, and every file in it is judged. The exemption reads the importing file only: a file inside a package stays held to the rule whatever it reaches for.
