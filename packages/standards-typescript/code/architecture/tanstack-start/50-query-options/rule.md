---
summary: "TanStack Query options declared outside the feature's `queries/` folder"
checked: false
severity: advisory
---

### Query Options

Query-options factories live in the feature's `queries/` folder — the
conventional [domain folder](../../folder-structure/55-domain-graduation/rule.md)
for a feature's query definitions (a grouping, not a module: no `index.ts`,
per [a domain folder is not a module](../../folder-structure/65-domain-folder-is-not-a-module/rule.md)).
This pack's convention — consistency across TanStack repos is worth the noun —
not a TanStack requirement.

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

The factory's inferred return type is deliberate — see the return-types note in
this channel's [document](../document.md).
