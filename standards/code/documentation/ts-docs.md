# TypeScript Documentation Style Guide

How to write TSDoc/JSDoc *when documentation is warranted* — it does not mandate doc comments on every export.

## When to Document

Default to self-documenting code. Add JSDoc only when:

- The **why** is non-obvious — business context, constraints, or gotchas a reader wouldn't guess from the code.
- The function has a **complex contract** — non-obvious parameter interactions, intentional error-throwing behavior, usage worth an example.
- The export is a **public API boundary** consumed by other packages or external callers.

If the name and types already communicate the purpose, skip the comment.

**Inline `//` comments:** default to none. Use only for a non-obvious workaround, a business rule embedded in logic (`// 30-day window per billing agreement`), or a deliberate deviation and why. Never narrate what the next line does.

## Elements

- **Description**: one or two sentences — what it does and why you'd use it. Focus on *why*; the code shows *what*.
- **`@param`**: name and purpose only — TypeScript owns the type. For object-args functions, `@param` tags document the destructured property names directly. Sentence fragments, lowercase.
- **`@throws`**: only errors intentionally thrown and expected to be caught: `@throws {ConnectionError} When the database is unreachable`.
- **`@returns`**: only when the value has semantics the type doesn't show (a `string` that is a JWT; a `boolean` where `true` means "already existed").
- **`@example`**: for complex APIs or non-obvious usage; minimal and runnable.
- **`@typeParam`**: when a generic's purpose isn't obvious from its name.

## Brittle Tags — Do NOT Use

`@version` / `@since` / `@author` (git owns these) · `@type` / `@default` / `@readonly` / `@private` / `@public` / `@protected` / `@memberof` (TypeScript owns these) · `@see` with URLs (use `@see {@link SymbolName}` instead) · `@todo` (issue tracker) · `@deprecated` without a migration path.

## Params Interfaces

Do NOT document a function's local `Params` interface — the function's `@param` tags are sufficient. Individual properties inside it may carry `/** */` comments only when name + type don't convey the contract (`/** Display name shown in the UI, may differ from username */`), and document interfaces at the type level, not every property.

## Complete Example

```typescript
interface Params<T> {
	fn: () => Promise<T>;
	maxAttempts?: number;
	baseDelay?: number;
}

/**
 * Retries an async operation with exponential backoff.
 *
 * Useful for network requests that may fail transiently.
 *
 * @param fn - async function to retry
 * @param maxAttempts - attempts before giving up
 * @param baseDelay - initial delay in ms, doubles after each failure
 * @throws {RetryExhaustedError} When all retry attempts fail
 */
export const retry = async <T>({ fn, maxAttempts = 3, baseDelay = 1000 }: Params<T>): Promise<T> => {
	// ...
};
```
