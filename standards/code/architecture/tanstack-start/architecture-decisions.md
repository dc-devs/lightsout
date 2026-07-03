# TanStack Start Architecture

Architecture decisions for TanStack Start applications. These patterns layer on top of [React architecture](../react/architecture-decisions.md).

## Feature Structure

Each feature in `src/features/` follows this pattern:

```
features/{feature}/
├── common/                    # Feature-wide shared code
│   ├── constants/
│   ├── types/
│   └── utils/
├── components/                # Feature-wide reusable components
├── hooks/                     # Feature-specific React hooks
├── queries/                   # TanStack Query options
├── screens/                   # Screen components (route destinations)
│   └── {ScreenName}/
│       ├── components/        # Screen-specific components
│       │   └── common/        # Shared across screen components
│       ├── hooks/             # Screen-specific hooks
│       ├── {ScreenName}.tsx
│       └── index.ts
├── serverFns/                 # TanStack server functions
└── index.ts                   # Feature barrel export
```

## Code Placement Hierarchy

| Scope              | Location                                                 | When to Use                         |
| ------------------ | -------------------------------------------------------- | ----------------------------------- |
| App-wide           | `src/common/`                                            | Used by 2+ features                 |
| Feature-wide       | `features/{feature}/common/`                             | Used by 2+ screens in one feature   |
| Screen-wide        | `features/{feature}/screens/{screen}/components/common/` | Used by 2+ components in one screen |
| Component-specific | `{component}/common/`                                    | Only used by one component          |

## Key Patterns

### Server Functions

Server functions live in `serverFns/` folders at feature or app level:

```
serverFns/
├── countIssues/
│   ├── CountIssuesDocument.ts    # GraphQL document (if applicable)
│   ├── countIssuesServerFn.ts    # Server function
│   └── index.ts
└── index.ts
```

### File Naming for Server Functions

| File type | Convention | Example |
|-----------|------------|---------|
| Server functions | `camelCase/` folder with `PascalCase` document + `camelCase` fn | `countIssues/CountIssuesDocument.ts`, `countIssuesServerFn.ts` |
| Queries | `camelCase.ts` | `issuesQueryOptions.ts` |

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

> **Return types:** query-options factories and hooks infer their return types — TanStack's `UseSuspenseQueryOptions`/`UseSuspenseQueryResult` generics are the contract, so this falls under the generic-heavy exception in [return-types.md](../../../fdrop:code:style-guide/references/typescript/return-types.md#return-types--explicit-on-exports-inferred-internally).
