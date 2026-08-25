---
summary: "a barrel re-exporting with `export *` instead of named re-exports"
checked: true
severity: advisory
---

## Barrel Files (`index.ts`)

A barrel is the module's **public API contract** — it lists exactly what consumers may use; everything it omits is internal.

1. **Every folder-module has an `index.ts`** — the only path other modules import through
2. **Named re-exports** — `export { Foo } from '<path>'` (alias when configured), never `export *`
3. **One export per line** — clean diffs
4. **Export deliberately** — the barrel MAY re-export from subfolders when those items are intentionally public; omissions are internal
5. **No barrels anywhere under `common/`** — a barrel is a boundary marker (the barrel-omission test), and `common/` is definitionally boundary-less; imports into `common/` always target the file directly. An `index.ts` there would assert a boundary that does not exist — and sits where the scanner deliberately does not look

## Barrel Exports (`index.ts`)

A graduated folder-module's `index.ts` is its public API contract — the single import path other modules use. Barrel rules (named re-exports, one export per line, deliberate surface) are defined in [module-api.md](../style-guide/structure/module-api.md#barrel-files-indexts).

The barrel question is answered for every source dialect: an `index.js`, `index.mjs`, `index.jsx` or `index.tsx` barrel is judged exactly as `index.ts` is.
