# Module Boundaries & Exports

## Module Boundaries

A **folder-module** (a feature, route, screen, graduated class or component — see the [architecture decisions](../../../fdrop:code:architecture/references/architecture-decisions.md#modules--the-graduation-rule)) has a public API: its `index.ts`.

**The boundary rule:**

- **Crossing a module boundary:** import ONLY from the module's `index.ts`. Never reach into another module's internals.
- **Inside a module:** import directly from specific files. Deep imports within your own module are correct, not a violation.

The `index.ts` is the module's deliberate public API, not a directory listing.

✅ GOOD: Cross-module import through the index

```typescript
// in features/reports/...
import { ingestRecords } from '@/ingestion';
```

❌ BAD: Reaching into another module's internals

```typescript
// in features/reports/...
import { normalizeRecord } from '@/ingestion/common/utils/normalizeRecord'; // WRONG — internal
```

✅ GOOD: Deep import within your own module

```typescript
// in ingestion/ingestRecords.ts
import { normalizeRecord } from '@/ingestion/common/utils/normalizeRecord';
```

## Module Exports

### Functions and Classes

- Always use named exports
- Export class, method, interface, constant, etc. on the same line it is defined

#### Example Function

**`myNewMethod.ts`** (file name follows [per-package convention](../conventions/file-naming.md))

```typescript
export const myNewMethod = () => {
	// Method code here
};
```

#### Example Class

**`MyNewClass.ts`**

```typescript
export class MyNewClass {
	// Class code here
}
```

#### Example Interface

**`MyInterface.ts`**

```typescript
export interface MyInterface {
	property1: string;
	property2: number;
}
```

#### Example Named Constant

**`MyConstant.ts`**

```typescript
export const MyConstant = {
	Value1: 'value1',
	Value2: 'value2',
} as const;

export type MyConstant = (typeof MyConstant)[keyof typeof MyConstant];
```

## Barrel Files (`index.ts`)

A barrel file is the module's **public API contract** — it lists exactly what consumers may use. Everything it omits is internal, and the lint boundary makes that real.

**Rules:**

1. **Every folder-module has an `index.ts`** — it is the only path other modules import through (the boundary rule above)
2. **Use named re-exports** — `export { Foo } from '<path>'` (use the package's import-path convention — alias when configured), never `export *`
3. **One export per line** — makes diffs clean and review easy
4. **Export deliberately** — the barrel exports the module's intended public surface. It MAY re-export from subfolders when those items are intentionally public; everything it omits is internal.
5. **Internal subfolders** (`common/utils/`, `common/types/`, etc.) keep their own `index.ts` for tidy intra-module imports, but those barrels are internal — nothing outside the module imports from them (the boundary rule above).

✅ GOOD: Barrel as deliberate public API

**`ingestion/index.ts`**

```typescript
export { ingestRecords } from '@/ingestion/ingestRecords';
export type { RawRecord } from '@/ingestion/common/types/RawRecord';
```

`RawRecord` is re-exported from a subfolder *on purpose* — it is part of the module's contract. `normalizeRecord` is not exported — it is internal, and the lint boundary makes that real.
