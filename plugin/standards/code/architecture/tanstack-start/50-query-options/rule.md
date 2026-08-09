---
summary: "TanStack Query options declared outside the feature's `queries/` folder"
checked: false
severity: advisory
---

### Query Options

TanStack Query options are centralized in `queries/` folders:

```typescript
// features/issues/queries/issuesQueryOptions.ts
interface Params {
	searchParams: IssuesSearchParams;
}

export const issuesQueryOptions = ({ searchParams }: Params) =>
	queryOptions({
		queryKey: [QueryKey.Issues, searchParams],
		queryFn: () => findAllIssuesServerFn({ data: searchParams }),
	});
```
