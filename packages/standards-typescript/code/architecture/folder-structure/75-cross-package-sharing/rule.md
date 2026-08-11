---
summary: "code two packages need duplicated per package instead of moved to the shared one"
checked: false
severity: advisory
---

## Cross-Package Sharing (`packages/shared/`)

Code needed by 2+ packages belongs in a shared package — not duplicated per-package.

A pure-contracts/shared package — one where everything is public by design —
is a `common/`-like space: its `src/` holds **domain folders**, not modules.
The barrel-omission test computes this per folder (a barrel that hides
nothing → domain folder, no boundary), which is also how the scanner
classifies it.
