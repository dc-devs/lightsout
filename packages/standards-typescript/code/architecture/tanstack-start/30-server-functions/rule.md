---
summary: "a server function living outside a `serverFns/` folder"
checked: false
severity: advisory
---

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
