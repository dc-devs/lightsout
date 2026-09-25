---
summary: "a shared concept with companions only it uses left inside `common/` instead of graduating to its own folder"
checked: false
severity: advisory
---

## What Lives in `common/` — the Companion Test

`common/` holds shared **single files only**: primitives (a stateless function, a type, a constant, one service class) filed under their type subfolder. It never holds a concept with parts of its own.

A shared concept must leave `common/` and become its own folder — a sibling of the features that use it — the moment it has companions: files that exist only to serve it. The mechanical test: **does any of its files serve only the concept itself?**

- No — every file is something its users call directly → it is a bag of primitives → its files go in `common/<type>/` (or a domain folder)
- Yes → it is a concept with parts of its own → it graduates to its own folder, and its companions go with it

This keeps placement closed under growth: shared code is either a primitive (`common/`) or a concept with its own folder (a domain sibling) — there is no third place.
