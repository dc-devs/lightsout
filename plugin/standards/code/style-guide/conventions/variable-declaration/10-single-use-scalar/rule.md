---
summary: "a module-scope scalar constant only one place reads"
checked: true
severity: advisory
---

## Don't Hoist Single-Use Scalars

Don't hoist single-use scalars to module scope or a constants file. A value used by one function and not a lookup map is declared inline — `const maxRetries = 10;` inside the function, not `const MAX_RETRIES = 10;` at module scope. Promote to a module-level constant (or `constants/`) only when it's consumed in 2+ places, or it's a lookup map / structured config.
