# Module Boundaries & Exports

## Module Boundaries

A **folder-module** (feature, route, screen, graduated class or component — see [architecture-decisions.md](../../architecture/architecture-decisions.md#modules--the-graduation-rule)) has a public API: its `index.ts`.

- **Crossing a module boundary:** import ONLY from the module's `index.ts` — never reach into another module's internals (`@/ingestion`, not `@/ingestion/common/utils/normalizeRecord`).
- **Inside a module:** import directly from specific files — deep imports within your own module are correct.

## Module Exports

- Always named exports, on the line the item is defined — functions, classes, interfaces, and `as const` named constants alike.

## Barrel Files (`index.ts`)

A barrel is the module's **public API contract** — it lists exactly what consumers may use; everything it omits is internal.

1. **Every folder-module has an `index.ts`** — the only path other modules import through
2. **Named re-exports** — `export { Foo } from '<path>'` (alias when configured), never `export *`
3. **One export per line** — clean diffs
4. **Export deliberately** — the barrel MAY re-export from subfolders when those items are intentionally public; omissions are internal
5. **Internal subfolders** (`common/utils/`, `common/types/`) keep their own `index.ts` for tidy intra-module imports, but nothing outside the module imports from them

```typescript
// ingestion/index.ts — RawRecord re-exported on purpose; normalizeRecord stays internal
export { ingestRecords } from '@/ingestion/ingestRecords';
export type { RawRecord } from '@/ingestion/common/types/RawRecord';
```
