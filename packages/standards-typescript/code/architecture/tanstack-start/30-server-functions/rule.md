---
summary: "a server function living outside a `serverFns/` folder, or wrapped in a one-file folder with a barrel it has not earned"
checked: false
severity: advisory
---

## Key Patterns

### Server Functions

Server functions live in a `serverFns/` folder at feature or app level — the
feature's domain folder for its server calls. Each server function follows the
graduation rule like everything else: **a file by default, a folder only when
it has private companions**.

```
serverFns/
├── countIssuesServerFn.ts        # default: one file, no folder ceremony
└── findIssues/                   # graduated: it has a private companion
    ├── FindIssuesDocument.ts     #   the GraphQL document only it uses
    ├── findIssuesServerFn.ts
    └── index.ts
```

A folder holding one server function and a barrel is ceremony the graduation
rule forbids — the framework mandates nothing about this layout; the trigger
for a folder is the companion file, never the category.
