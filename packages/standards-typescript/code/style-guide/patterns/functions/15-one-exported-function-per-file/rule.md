---
summary: "a second exported function kept in a file because it is closely related"
checked: false
severity: advisory
---

## One Exported Function Per File — Not Negotiable

Every **exported** function gets its own file, named after the export (cased per [file-naming.md](../conventions/file-naming.md)). Rationalizations that are NOT valid: "closely related", "both config functions", "over-engineered to split", "one is just a helper for the other" — if it's truly a helper, make it **non-exported** and co-locate it; if it's exported, it gets its own file.

```typescript
// ❌ config.ts exporting loadConfig AND saveConfig — split into loadConfig.ts + saveConfig.ts
```
