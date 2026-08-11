---
summary: "a level grown by inventing a new kind of place instead of graduating a file or consolidating siblings"
checked: false
severity: advisory
---

## Growing Without New Rules

At every level exactly three kinds of things exist: **modules**, **`common/`**, and **files**. Growth never invents a new kind of place — it is always one of two mechanical moves:

- **Graduate** — a file needs private companions → it becomes a module ([the graduation rule](./architecture-decisions.md#modules--the-graduation-rule))
- **Consolidate** — a level holds more than ~20 modules → group related sibling modules under a new parent domain module (recursive: a module within a module, each keeping its own barrel)
