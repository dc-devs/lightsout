---
summary: "a server function file that does not carry its mandated casing"
checked: false
severity: advisory
---

### File Naming for Server Functions

The [filename-match rule](../../../style-guide/conventions/file-naming/05-filename-mismatch/rule.md)
applied to server-function exports — a file is named for what it exports, in
that export's own casing. The table is derived, not a separate law:

| File holds | So its name is | Example |
|-----------|------------|---------|
| A server function (`camelCase` export ending `ServerFn`) | `camelCase.ts` ending `ServerFn` | `serverFns/countIssuesServerFn.ts` |
| A graduated server function's folder | that function's `camelCase/` | `findIssues/` |
| A GraphQL document (`PascalCase` named constant) | `PascalCase.ts` | `findIssues/FindIssuesDocument.ts` |
| A query-options factory (`camelCase` export) | `camelCase.ts` | `queries/issuesQueryOptions.ts` |

The `ServerFn` suffix is this pack's convention for making a server call
recognizable at the import site — TanStack requires no naming.
