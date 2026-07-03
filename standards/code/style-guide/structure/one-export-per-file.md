# One Export Per File

- Each **exported** function, class, interface, type, or constant has its own dedicated file
- The file name matches the exported item name (cased per the package's file-naming convention)
- Non-exported items (private helpers, local types) may co-locate with the export they serve

## The Closed Exception List

These are the **only** cases where a file may contain more than one item. Every exception has a mechanical criterion — there is no judgment call:

| # | Exception | Criterion |
|---|-----------|-----------|
| 1 | `Params` / `ConstructorParams` interfaces | Stays in the file of its function/class; not exported independently |
| 2 | Private helpers | Not exported; called only within this file (see [functions.md](../patterns/functions.md#private-helpers-may-co-locate)) |
| 3 | Discriminated union families | A union type and its member types share one file when the members exist only as constituents of that union |
| 4 | Named constant + derived lookup map | A lookup map keyed by the union (`Record<MyType, …>`) may live in the `const` object's file (see [named-constants.md](../patterns/named-constants.md#derived-lookup-maps-may-co-locate)) |

## Multiple Exported Items — Still Not Negotiable

Multiple **exported** items of independent meaning never share a file.

**Rationalizations that are NOT valid:**

- "The interface is only used by this constant" → Still separate files
- "They're closely related" → Still separate files
- "It's just a small helper" → If it's a helper, make it non-exported (exception 2). If it's exported, separate file.

❌ BAD: Exported interface and exported constant in same file

**`config.ts`**

```typescript
export interface Config {
	name: string;
}

export const defaultConfig: Config = { name: 'default' };
```

✅ GOOD: Separate files

**`common/types/Config.ts`**

```typescript
export interface Config {
	name: string;
}
```

**`common/constants/defaultConfig.ts`**

```typescript
import type { Config } from '@/path/to/common/types/Config';

export const defaultConfig: Config = { name: 'default' };
```

✅ GOOD: Discriminated union family in one file (exception 3)

**`common/types/SyncEvent.ts`**

```typescript
import { SyncEventKind } from '@/common/constants/SyncEventKind';

export interface FileAddedEvent {
	kind: typeof SyncEventKind.FileAdded;
	path: string;
}

export interface RecordParsedEvent {
	kind: typeof SyncEventKind.RecordParsed;
	recordId: string;
}

export type SyncEvent = FileAddedEvent | RecordParsedEvent;
```

The discriminant references the `const` object, not raw literals — see [named-constants.md](../patterns/named-constants.md#discriminants-use-the-const-object). The `const` object lives in its own file in `constants/`.

The members exist only as constituents of `SyncEvent` — splitting them across files would fragment one concept. If a member type starts being used independently of the union, it moves to its own file.
