---
summary: "a folder-module with no `index.ts` stating its public API"
checked: false
severity: advisory
---

## Barrel Exports (`index.ts`)

A graduated folder-module's `index.ts` is its public API contract — the single import path other modules use. Barrel rules (named re-exports, one export per line, deliberate surface) are defined in [module-api.md](../style-guide/structure/module-api.md#barrel-files-indexts).
