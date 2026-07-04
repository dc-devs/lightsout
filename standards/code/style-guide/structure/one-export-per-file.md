# One Export Per File

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
