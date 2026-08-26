---
summary: "a React file whose name does not carry the casing its kind mandates"
checked: false
severity: advisory
---

## File Naming Conventions

The [filename-match rule](../../../style-guide/conventions/file-naming/05-filename-mismatch/rule.md)
applied to React exports — a file is named for what it exports, in that
export's own casing — plus the
[folder-casing rule](../../folder-structure/50-folder-casing/rule.md) for
folders. The table below is derived from those two rules, not a separate law:

| File holds | So its name is | Example |
|-----------|------------|---------|
| A component (`PascalCase` export) | `PascalCase.tsx` | `IssueDetailContent.tsx` |
| A hook (`useX` export) | `camelCase.ts` | `useIssues.ts`, `useUpdateIssue.ts` |
| A util (`camelCase` export) | `camelCase.ts` | `buildOrderBy.ts`, `formatDate.ts` |
| An interface or named-constant object | `PascalCase.ts` | `QueryKey.ts`, `FilterOption.ts` |
| A plain constant | `camelCase.ts` | `emailRegex.ts`, `defaultPaginationPage.ts` |
| A category folder | `camelCase/` | `components/`, `hooks/`, `queries/` |
| A graduated component folder | that component's `PascalCase/` | `IssueDetail/`, `IssueHeaderToolbar/` |

`.tsx` for a file containing JSX is TypeScript's requirement, not a React
mandate — React itself names nothing.
