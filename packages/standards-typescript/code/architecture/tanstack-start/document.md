---
channel: tanstack
---

# TanStack Start Architecture

Architecture decisions for TanStack Start applications. These patterns layer on top of [React architecture](../react/architecture-decisions.md).

**Return types:** TanStack query-options factories under a `queries/` folder infer — the inferred `queryOptions` type carries the key and data types a hand-written annotation would flatten. This is the TanStack form of the explicit-return-type rule's exceptions.
