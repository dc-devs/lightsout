---
summary: "a top-level folder naming a technical layer rather than a capability the product has"
checked: false
severity: advisory
---

## Top Level Is Domain Nouns

`src/`'s top level names domains (`billing/`, `issues/`, `sync/`) — capabilities the product has. Infrastructure capabilities are domains too: `git/`, `config/`, `runState/` are valid module names. Navigation is by domain first, for humans and agents alike.
