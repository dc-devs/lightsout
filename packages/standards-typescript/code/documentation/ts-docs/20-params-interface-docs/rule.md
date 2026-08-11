---
summary: "a doc comment on a function's local Params interface, or on every property inside it"
checked: false
severity: advisory
---

## Params Interfaces

Do NOT document a function's local `Params` interface — the function's `@param` tags are sufficient. Individual properties inside it may carry `/** */` comments only when name + type don't convey the contract (`/** Display name shown in the UI, may differ from username */`), and document interfaces at the type level, not every property.
