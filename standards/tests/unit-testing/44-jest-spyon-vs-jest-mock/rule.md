---
summary: "`jest.mock` where a spy on the object already held would do, or the reverse"
checked: false
severity: advisory
---

### `jest.spyOn` vs `jest.mock`

- Prefer **`jest.spyOn`** for a single method on an object you already hold (an injected service/repository), leaving the rest intact.
- Prefer **`jest.mock`** for a standalone exported function from another module.
