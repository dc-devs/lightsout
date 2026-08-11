---
summary: "a query-wrapping hook outside the feature's `hooks/` folder"
checked: false
severity: advisory
---

### Hooks

Custom hooks that wrap queries or manage state:

```typescript
// features/issues/hooks/useIssues.ts
interface Params {
	searchParams: IssuesSearchParams;
}

export const useIssues = ({ searchParams }: Params) => {
	return useSuspenseQuery(issuesQueryOptions({ searchParams }));
};
```

> **Return types:** query-options factories and hooks infer their return types — TanStack's `UseSuspenseQueryOptions`/`UseSuspenseQueryResult` generics are the contract, so this falls under the generic-heavy exception in [return-types.md](../../style-guide/typescript/return-types.md#return-types--explicit-on-exports-inferred-internally).
