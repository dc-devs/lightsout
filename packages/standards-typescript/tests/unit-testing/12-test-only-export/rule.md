---
summary: "an export only its own tests reference"
checked: true
severity: advisory
---

An export whose only references anywhere are test files is a hint, not a
violation: production never calls it, so it may be dead code wearing a test —
or a deliberate promotion whose contract the tests pin. The finding asks the
question; a human answers it.
