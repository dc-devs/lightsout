---
summary: "a barrel re-exporting with `export *` instead of naming what it publishes"
checked: true
severity: advisory
---

## Barrel Files (`index.ts`)

A barrel is the module's **public API contract** — it lists exactly what consumers may use; everything it omits is internal. A graduated folder-module's `index.ts` is the single import path other modules use.

1. **Every folder-module has an `index.ts`** — the only path other modules import through
2. **Named re-exports** — `export { Foo } from '<path>'` (alias when configured), never `export *`: a star re-export publishes whatever the target happens to export, so the contract stops being a decision and the scanner stops being able to read it
3. **Export deliberately** — the barrel MAY re-export from subfolders when those items are intentionally public; omissions are internal
4. **No barrels anywhere under `common/`** — a barrel is a boundary marker (the barrel-omission test), and `common/` is definitionally boundary-less; imports into `common/` always target the file directly. An `index.ts` there would assert a boundary that does not exist — and sits where the scanner deliberately does not look

Line shape is the formatter's business, not this rule's — how re-exports wrap or merge follows the project's formatter configuration.

The barrel question is answered for every source dialect: an `index.js`, `index.mjs`, `index.jsx` or `index.tsx` barrel is judged exactly as `index.ts` is.
