---
summary: "a domain folder under `common/` carrying an `index.ts` or a private file"
checked: false
severity: advisory
---

A domain folder is **not** a module — by the barrel-omission test it hides nothing: every file in it is public, it carries **no `index.ts`** (no barrels under `common/`; see module-api.md), and imports target its files directly. The moment a domain folder needs a private file, it has become a module and moves out of `common/`.
