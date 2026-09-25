---
summary: "an import through a folder's `index.ts`, or of a file another module's `index.ts` does not export"
checked: true
severity: advisory
---

## Module Boundaries

A **folder-module** (feature, route, screen, graduated class or component — see [architecture-decisions.md](../../architecture/architecture-decisions.md#modules--the-graduation-rule)) has a public API, and its `index.ts` lists it.

- **Import from the file that declares the name:** never through a folder's `index.ts` (`@/ingestion/ingestRecords`, not `@/ingestion`). An import through an `index.ts` loads every file it re-exports, and everything those files import, to reach one name — which a bundler drops again, and a test runner does not. Only another `index.ts` points at an `index.ts`, to re-export what a lower module publishes.
- **Crossing a module boundary:** import ONLY files the module's `index.ts` exports — directly or through a lower `index.ts` — never another module's internals (`@/ingestion/ingestRecords`, not `@/ingestion/common/utils/normalizeRecord`). With modules inside modules, the outermost module the import enters decides.
- **Inside a module:** import directly from specific files — imports between your own module's files are correct, and so is a test beside its file importing that file.
- **The package entry:** a package's own `src/index.ts` is its public API for other packages. Code inside the package does not import it; other packages do.

A folder the package's framework mandates as a module — a TanStack Start screen under `features/*/screens/*` — is a boundary whatever the barrel-omission test says; the mandate, not the concealment, is what declares it.

Module boundaries are a package's own architecture, so this rule judges only a file that belongs to a package. Where the repo's manifests declare workspace packages, a file outside every one of them — a build script at the repo root, say — belongs to no package's architecture and is not held to this rule. A repo whose manifests declare no workspace package is itself one package, and every file in it is judged. The exemption reads the importing file only: a file inside a package stays held to the rule whatever it reaches for.
