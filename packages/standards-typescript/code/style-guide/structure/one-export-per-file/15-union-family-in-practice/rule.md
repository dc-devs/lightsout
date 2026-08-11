---
summary: "a union member type used on its own while still sharing the union's file"
checked: false
severity: advisory
---

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
