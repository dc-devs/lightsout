---
summary: "two or more utils about the same subject left loose in `utils/` instead of grouped in a folder named for it"
checked: true
severity: advisory
---

## Domain Folders

A stateless function starts in `utils/`. When a second related function with a shared domain appears, both graduate to a named domain folder (sibling of `utils/`) — `formatting/`, `validation/`, `parsing/`. One function alone never gets a domain folder; stateful code stays in `services/`.
