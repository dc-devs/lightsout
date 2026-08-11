---
summary: "a shared concept with private internals left inside `common/` instead of graduating to its own module"
checked: false
severity: advisory
---

## What Lives in `common/` — the Barrel-Omission Test

`common/` holds shared **file-modules only**: single-file primitives (a stateless function, a type, a constant, one service class) filed under their type subfolder. It never contains folder-modules.

A shared concept must leave `common/` and become a module — a sibling of the features that use it — the moment it has private internals. The mechanical test: **write the concept's would-be barrel. Does it omit anything?**

- Everything would be exported → it is a bag of primitives → its files go in `common/<type>/` (or a domain folder)
- The barrel would hide something → it is a module with a boundary worth enforcing → module with its own `index.ts`

This keeps placement closed under growth: shared code is either a primitive (`common/`) or a module (a domain sibling) — there is no third place.
