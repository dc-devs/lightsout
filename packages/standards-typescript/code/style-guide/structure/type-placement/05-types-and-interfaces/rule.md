---
summary: "a shared type-level declaration living somewhere other than `common/types/`"
checked: false
severity: advisory
---

## Types and Interfaces → `common/types/`

The folder groups type-level declarations regardless of keyword. Pick the keyword by fit, not folder:

- `interface` for object shapes (extends and merges cleanly)
- `type` for what an interface can't express (unions, intersections, mapped types, primitives, tuples, function signatures)
- Either works for an object shape → stay consistent within a domain. Refactoring between the keywords is an in-place edit; the filename and imports never change.

A discriminated union family lives in `types/` under the union's name.

**The `Params` interface stays with its function; all other exported types go in `types/`:**

```typescript
// copyFile.ts — Params co-located, unexported
interface Params {
	sourcePath: string;
	destPath: string;
}

export const copyFile = ({ sourcePath, destPath }: Params) => { /* ... */ };

// common/types/CopyResult.ts — exported return type gets its own types/ file
export interface CopyResult {
	success: boolean;
	bytesWritten: number;
}
```
