---
summary: "export names differing only by synonym or word order"
checked: true
severity: advisory
---

## Verb Vocabulary (closed)

New code draws function verbs from this closed set — synonyms are how duplicates hide from name-level search (agents and humans both navigate by grep):

`get` · `create` · `update` · `delete` · `format` · `parse` · `validate` · `build` · `to`/`from` (conversions) · `is`/`has`/`should`/`can` (booleans)

Banned synonyms: `fetch`/`load`/`retrieve`/`read` → `get` · `make`/`generate`/`produce` → `create` · `remove` → `delete` · `modify` → `update` · `verify`/`check` → `validate`.
