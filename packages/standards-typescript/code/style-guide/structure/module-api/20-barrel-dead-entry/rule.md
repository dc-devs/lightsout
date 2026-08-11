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
