---
summary: "sibling utils sharing a subject verb — a domain-folder candidate"
checked: true
severity: advisory
---

## Domain Folders

A stateless function starts in `utils/`. When a second related function with a shared domain appears, both graduate to a named domain folder (sibling of `utils/`) — `formatting/`, `validation/`, `parsing/`. One function alone never gets a domain folder; stateful code stays in `services/`.
