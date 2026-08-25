---
summary: "a feature folder pre-creating layout the graduation rule has not earned"
checked: false
severity: advisory
---

## Feature Structure

A feature under `src/features/` is a module: its `index.ts` is its public API
([module boundary](../../../style-guide/structure/module-api/05-module-boundary/rule.md)),
and everything inside it grows by the
[graduation rule](../../folder-structure/55-ungrouped-domain-utils/rule.md) — a
single file until companions or a shared subject earn a folder. There is no
fixed feature tree to stamp out; these are the domain folders a TanStack
feature *commonly grows*, each created when graduation triggers and never
before:

- `screens/` — route-destination components; a screen graduates to its own
  folder exactly as any component does
  ([component file structure](../../react/10-component-file-structure/rule.md))
- `queries/` — query-options factories (see the query-options rule)
- `serverFns/` — server functions (see the server-functions rule)
- `hooks/` — query-wrapping hooks
- `components/` — feature-wide components
- `common/` — feature-internal shared code

Where a piece of code lives — app-wide `src/common/`, feature `common/`, or
beside its one consumer — is the base
[placement rule](../../folder-structure/05-placement/rule.md), unchanged here.

None of this is TanStack's requirement. What TanStack mandates — route
filenames under `routes/`, the `router.tsx`/`server.ts`/`client.tsx` entry
files — lives in the framework carve-out table; the layout above is this
pack's convention for the code the framework says nothing about.
