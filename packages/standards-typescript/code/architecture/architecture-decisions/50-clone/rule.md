---
summary: "token-level copy-paste spans"
checked: true
severity: advisory
settings:
  minTokens: 50
---

### Duplicated Patterns & Logic

The same pattern in 2+ files gets extracted to the lowest common ancestor `common/` (loading/error state handling, validation logic, repeated transformations, generic named constants like a `SortDirection` union belong in `src/common/constants/`).

**The composition remedy is never a clone.** A class that holds a shared collaborator and forwards to it through one-line methods (`update() { return this.runState.update(...) }`) repeats that shape in every class holding the same collaborator — by design: it is what the class-inheritance rule mandates in place of `extends` (see the thin-wrapper rule's carve-out). Both duplication tiers skip it.

