---
summary: "more than one export in a file, outside the closed exception list"
checked: true
severity: advisory
---

- Each **exported** function, class, interface, type, or constant has its own file, named after the export (cased per the package's file-naming convention)
- Non-exported items (private helpers, local types) may co-locate with the export they serve

## The Closed Exception List

The **only** cases where a file may contain more than one item — every exception has a mechanical criterion:

| # | Exception | Criterion |
|---|-----------|-----------|
| 1 | `Params` / `ConstructorParams` interfaces | Stays in the file of its function/class; not exported independently |
| 2 | Private helpers | Not exported; called only within this file (see [functions.md](../patterns/functions.md#private-helpers-may-co-locate)) |
| 3 | Discriminated union families | A union type and its member types share one file when the members exist only as constituents of that union |
| 4 | Named constant + derived lookup map | A lookup map keyed by the union (`Record<MyType, …>`) may live in the `const` object's file (see [named-constants.md](../patterns/named-constants.md#derived-lookup-maps-may-co-locate)) |
| 5 | A type + the single value typed by it | `interface Config` beside `export const defaultConfig: Config` share one file, filed under the value's name — the default has no consumer the type does not already have |

## Multiple Exported Items — Still Not Negotiable

Invalid rationalizations: "the interface is only used by this constant", "they're closely related", "it's just a small helper" (if it's a helper, make it non-exported — exception 2; if exported, own file).

```typescript
// ❌ config.ts: export interface Config + export const defaultConfig — split them:
// common/types/Config.ts        → export interface Config { ... }
// common/constants/defaultConfig.ts → export const defaultConfig: Config = { ... }
```

**Exception 3 in practice** — a union family shares one file because the members exist only as constituents:

```typescript
// common/types/SyncEvent.ts
export interface FileAddedEvent {
	kind: typeof SyncEventKind.FileAdded; // discriminant references the const object, never a raw literal
	path: string;
}

export interface RecordParsedEvent {
	kind: typeof SyncEventKind.RecordParsed;
	recordId: string;
}

export type SyncEvent = FileAddedEvent | RecordParsedEvent;
```

If a member type starts being used independently of the union, it moves to its own file.

## One Exported Function Per File — Not Negotiable

Every **exported** function gets its own file, named after the export (cased per [file-naming.md](../conventions/file-naming.md)). Rationalizations that are NOT valid: "closely related", "both config functions", "over-engineered to split", "one is just a helper for the other" — if it's truly a helper, make it **non-exported** and co-locate it; if it's exported, it gets its own file.

```typescript
// ❌ config.ts exporting loadConfig AND saveConfig — split into loadConfig.ts + saveConfig.ts
```

## Grouping Values: One Named Object, Never a Bag

When several values form one concept — a feature's thresholds, a set of retry
defaults — export **one named object**:

```typescript
// featureThresholds.ts
export const featureThresholds = { maxBatchSize: 20, maxRetries: 3 } as const;
```

That is one export (no exception needed), the group has a name at every use
site, and it greps. What stays banned is the bag: a `constants.ts` with a
dozen loose exports is unnamed by its file, invisible to search, and grows
forever.

