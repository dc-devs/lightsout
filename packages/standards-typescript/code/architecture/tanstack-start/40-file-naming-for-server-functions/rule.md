---
summary: "a server function file that does not carry its mandated casing"
checked: false
severity: advisory
---

### File Naming for Server Functions

| File type | Convention | Example |
|-----------|------------|---------|
| Server functions | `camelCase/` folder with `PascalCase` document + `camelCase` fn | `countIssues/CountIssuesDocument.ts`, `countIssuesServerFn.ts` |
| Queries | `camelCase.ts` | `issuesQueryOptions.ts` |
