---
channel: tanstack
---

# TanStack Start Architecture

How the base rules apply to a TanStack Start application, layered on top of the
[React channel](../react/document.md). Two kinds of statement live here, and
each is labeled by what it is:

- **Mandated** — what TanStack Start resolves by convention: route filenames
  under `routes/` (including `__root.tsx` and the `/` route's `index.tsx`), and
  the `router.tsx`, `server.ts` and `client.tsx` entry files. These facts live
  in the framework carve-out table, which the checks consult — this document
  refers to them and never restates them as rules.
- **Applied** — how the base rules (graduation, domain folders, placement,
  filename-match) read against a TanStack feature. Everything below is this
  pack's convention, cited to the base rule it applies, never a TanStack
  requirement.

**Return types:** TanStack query-options factories under a `queries/` folder infer — the inferred `queryOptions` type carries the key and data types a hand-written annotation would flatten. This is the TanStack form of the explicit-return-type rule's exceptions.
