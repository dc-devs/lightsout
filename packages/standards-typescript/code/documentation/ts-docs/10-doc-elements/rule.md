---
summary: "a tag carrying what its type already says, or a description repeating the code"
checked: false
severity: advisory
---

## Elements

- **Description**: one or two sentences — what it does and why you'd use it. Focus on *why*; the code shows *what*.
- **`@param`**: name and purpose only — TypeScript owns the type. For object-args functions, `@param` tags document the destructured property names directly. Sentence fragments, lowercase.
- **`@throws`**: only errors intentionally thrown and expected to be caught: `@throws {ConnectionError} When the database is unreachable`.
- **`@returns`**: only when the value has semantics the type doesn't show (a `string` that is a JWT; a `boolean` where `true` means "already existed").
- **`@example`**: for complex APIs or non-obvious usage; minimal and runnable.
- **`@typeParam`**: when a generic's purpose isn't obvious from its name.
