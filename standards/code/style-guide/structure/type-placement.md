# Type & Constant Placement

These placement rules govern **shared** declarations. An exported type or
constant with no second consumer is a file-module wherever its consumers live
— `common/` placement is earned by sharing, never by kind (see the Code
Placement Philosophy in architecture-decisions.md).

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

## Constants → `common/constants/`

Constants are not types — they live in `common/constants/` (`export const …`), never in `types/`. A `const` object with its derived union and lookup map lives in `constants/` under the object's name (see [named-constants.md](../patterns/named-constants.md)).

```typescript
// common/constants/defaultConfig.ts
import type { Config } from '@/path/to/common/types/Config';

export const defaultConfig: Config = { name: 'default' };
```
