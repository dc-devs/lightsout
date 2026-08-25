---
summary: "a barrel entry no file outside the module consumes"
checked: true
severity: advisory
---

```typescript
// ingestion/index.ts — RawRecord re-exported on purpose; normalizeRecord stays internal
export { ingestRecords } from '@/ingestion/ingestRecords';
export type { RawRecord } from '@/ingestion/common/types/RawRecord';
```

A folder the package's framework mandates as a module — a TanStack Start screen under `features/*/screens/*` — is a boundary whatever the barrel-omission test says, so its barrel answers for its dead entries exactly as a graduated module's does.
