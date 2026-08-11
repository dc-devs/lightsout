---
summary: "a query reaching for a test id where a role, label or text would find the element"
checked: false
severity: advisory
---

## Query Priority

1. **`getByRole`** — mirrors how users and assistive technology find elements
2. **`getByLabelText`** — labeled form inputs
3. **`getByText`** — visible text
4. **`getByTestId`** — last resort (requires adding `data-testid` to source)

Use `query*` variants to assert an element is **not** rendered (they return `null` instead of throwing). Use `findBy*`/`waitFor` for elements that appear after an async update — a synchronous `getBy*` throws before the DOM settles.
