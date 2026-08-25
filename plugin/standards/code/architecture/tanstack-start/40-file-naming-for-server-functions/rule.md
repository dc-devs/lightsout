---
summary: "a server function file that does not carry its mandated casing"
checked: false
severity: advisory
---

### File Naming for Server Functions

| File type | Convention | Example |
|-----------|------------|---------|
| Server function (default, single file) | `camelCase` ending `ServerFn` | `serverFns/countIssuesServerFn.ts` |
| Graduated server function folder | `camelCase/` folder; `PascalCase` document + `camelCase` fn inside | `findIssues/FindIssuesDocument.ts`, `findIssuesServerFn.ts` |
| Queries | `camelCase.ts` | `issuesQueryOptions.ts` |
