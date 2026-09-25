---
summary: "an index file re-exporting with `export *` instead of naming what it publishes"
checked: true
severity: advisory
---

## Package Entry Files (`index.ts`)

A package's entry `index.ts` is its **public API contract** — it lists exactly what other packages may use. It is the one index file a package keeps: inside the package, every import names the file that declares what it imports.

1. **Named re-exports** — `export { Foo } from '<path>'` (alias when configured), never `export *`: a star re-export publishes whatever the target happens to export, so the contract stops being a decision and the scanner stops being able to read it
2. **Export deliberately** — the entry lists what other packages need, and nothing only the package itself uses

Line shape is the formatter's business, not this rule's — how re-exports wrap or merge follows the project's formatter configuration.

The question is answered for every source dialect: an `index.js`, `index.mjs`, `index.jsx` or `index.tsx` is judged exactly as `index.ts` is.
