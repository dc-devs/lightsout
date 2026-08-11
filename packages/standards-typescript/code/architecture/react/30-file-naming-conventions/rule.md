---
summary: "a React file whose name does not carry the casing its kind mandates"
checked: false
severity: advisory
---

## File Naming Conventions

| File type | Convention | Example |
|-----------|------------|---------|
| Components | `PascalCase.tsx` (or `PascalCase/` folder) | `IssueDetailContent.tsx`, `IssueDetail/` |
| Hooks | `camelCase.ts` | `useIssues.ts`, `useUpdateIssue.ts` |
| Utils | `camelCase.ts` | `buildOrderBy.ts`, `formatDate.ts` |
| Named constants, interfaces | `PascalCase.ts` | `QueryKey.ts`, `FilterOption.ts` |
| Constants | `camelCase.ts` | `emailRegex.ts`, `defaultPaginationPage.ts` |
| Folders (domain) | `camelCase` | `hooks/`, `components/`, `queries/` |
| Folders (component) | `PascalCase` | `IssueDetail/`, `IssueHeaderToolbar/` |
