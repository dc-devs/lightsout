---
summary: "code two packages need duplicated per package instead of moved to the shared one"
checked: false
severity: advisory
---

## Cross-Package Sharing (`packages/shared/`)

Code needed by 2+ packages belongs in a shared package — not duplicated per-package.

A pure-contracts/shared package — one where everything is public by design —
is a `common/`-like space: its `src/` holds **domain folders**, not modules.
The companion test decides this per folder: a folder whose every file is
something its users call directly is a domain folder.
