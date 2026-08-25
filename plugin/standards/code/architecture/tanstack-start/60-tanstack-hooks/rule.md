---
summary: "a query-wrapping hook outside the feature's `hooks/` folder"
checked: false
severity: advisory
---

### Hooks

Custom hooks that wrap queries or manage state live in the feature's `hooks/`
folder — the same convention the
[React channel's naming rule](../../react/30-file-naming-conventions/rule.md)
derives (`useX` export → `camelCase.ts`), applied to TanStack query wrappers:

```typescript
// features/issues/hooks/useIssues.ts
interface Params {
	searchParams: IssuesSearchParams;
}

export const useIssues = ({ searchParams }: Params) => {
	return useSuspenseQuery(issuesQueryOptions({ searchParams }));
};
```

The hook's inferred return type is deliberate — TanStack's generics are the
contract; see the return-types note in this channel's
[document](../document.md).
