# Type Placement

Types and interfaces live in `common/types/` — the folder groups type-level declarations regardless of keyword (`export type …` / `export interface …`). A discriminated union family lives in `types/` under the union's name.

## Interfaces vs Types — Same Folder, Pick by Fit

Both `interface` and `type` declarations live in `common/types/`. The keyword is a per-declaration choice, not a folder decision:

- Use an `interface` for object shapes — it extends and merges cleanly.
- Use a `type` for everything an interface cannot express — unions, intersections, mapped types, primitives, tuples, function signatures.
- When either would work for an object shape, use whichever you prefer and stay consistent within a domain.

Because both keywords share the `types/` folder, refactoring an object shape from `interface` to `type` (or back) is an in-place keyword edit — the filename, path, and imports never change.

✅ GOOD: Interface in the types folder

**`common/types/UserProfile.ts`**

```typescript
export interface UserProfile {
	id: string;
	name: string;
}
```

✅ GOOD: Type in the same folder

**`common/types/UserId.ts`**

```typescript
export type UserId = string;
```

## Where Non-Params Types Belong

The `Params` interface for a function stays with the function. **All other exported types and interfaces** go in the `types/` folder.

✅ GOOD: Params stays with function

**`copyFile.ts`**

```typescript
interface Params {
	sourcePath: string;
	destPath: string;
}

export const copyFile = ({ sourcePath, destPath }: Params) => {
	/* ... */
};
```

✅ GOOD: Return type in the types folder

**`common/types/CopyResult.ts`**

```typescript
export interface CopyResult {
	success: boolean;
	bytesWritten: number;
}
```

❌ BAD: Exported non-Params type defined in function file

**`copyFile.ts`**

```typescript
export interface CopyResult {
	// SHOULD BE IN common/types/
	success: boolean;
}
```
