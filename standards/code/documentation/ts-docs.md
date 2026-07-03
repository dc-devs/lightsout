# TypeScript Documentation Style Guide

This is a style guide for **how** to write TSDoc/JSDoc when you decide documentation is warranted. It does not mandate that every export needs a doc comment.

## When to Document

Default to self-documenting code: clear names, obvious purpose, no comment needed. Add JSDoc only when:

- The **why** is non-obvious — business context, constraints, or gotchas a reader wouldn’t guess from the code alone.
- The function has a **complex contract** — multiple parameters with non-obvious interactions, specific error-throwing behavior, or usage patterns that benefit from an example.
- The export is a **public API boundary** — consumed by other packages or external callers who cannot easily read the implementation.

If a function’s name and types already communicate its purpose, skip the doc comment.

## Inline Comments (`//`)

Default to no inline comments. Use `//` only when:

- Explaining a **non-obvious workaround** or edge case that would confuse a reader.
- Clarifying a **business rule** embedded in logic (e.g., `// 30-day window per billing agreement`).
- Marking a **deliberate deviation** from the expected pattern and why.

Never use `//` to narrate what the next line does — the code should speak for itself.

## Elements to Include (When Documenting)

### Description

Write a brief description explaining **what** it does and **why** you’d use it.

```typescript
/**
 * Validates user input against the schema and returns sanitized data.
 */
```

### Parameters (`@param`)

Document each parameter with its name and purpose. Let TypeScript handle the type. For object-args functions, `@param` tags document the destructured property names directly.

```typescript
interface Params {
	id: string;
	options?: FetchOptions;
}

/**
 * Fetches a user by their unique identifier.
 * @param id - The user's unique identifier
 * @param options - Configuration for the fetch request
 */
export const getUser = async ({ id, options }: Params): Promise<User> => {
	// ...
};
```

### Thrown Errors (`@throws`)

Only document errors that are intentionally thrown and expected to be caught.

```typescript
/**
 * Connects to the database.
 * @throws {ConnectionError} When the database is unreachable
 */
```

## Optional Elements

### Examples (`@example`)

Include for complex APIs or non-obvious usage patterns. Keep examples minimal and runnable.

```typescript
/**
 * Debounces a function call.
 * @param fn - Function to debounce
 * @param delay - Delay in milliseconds
 * @example
 * const debouncedSave = debounce({ fn: save, delay: 300 });
 * input.addEventListener('input', debouncedSave);
 */
```

### Return Values (`@returns`)

Use `@returns` when the return value has semantics not obvious from the type alone (e.g., a `string` that is actually a JWT, a `boolean` where `true` means "already existed").

```typescript
/**
 * Generates a versioned API key.
 * @returns a prefixed key string in the format `v1_<random>`
 */
```

### Generic Type Parameters (`@typeParam`)

Document generic parameters when their purpose isn't obvious from the name.

```typescript
/**
 * Creates a type-safe event emitter.
 * @typeParam T - Map of event names to their payload types
 */
```

## Avoid These (Brittle)

Do NOT include these tags as they become outdated or are redundant with TypeScript:
- `@version` – Use git tags/releases instead
- `@since` – Rarely maintained accurately
- `@author` – Git blame provides this
- `@type` – TypeScript already has this information
- `@default` – Visible in the function signature
- `@readonly`, `@private`, `@public`, `@protected` – Use TypeScript keywords
- `@memberof` – Unnecessary with modern tooling
- `@see` with URLs – URLs break; use `@see {@link SymbolName}` for cross-referencing related code symbols instead (IDE-resolved, survives renames)
- `@todo` – Use issue tracker instead
- `@deprecated` without migration path – If deprecating, explain what to use instead

## Skip Docs on Local Params Interfaces

When a function has a `Params` interface directly above it, do NOT document the interface — the function’s `@param` tags are sufficient.

❌ **BAD: Redundant interface doc**

```typescript
/**
 * Parameters for copyFile.
 */
interface Params {
	sourcePath: string;
	destPath: string;
}
```

✅ **GOOD: No doc on local Params interface**

```typescript
interface Params {
	sourcePath: string;
	destPath: string;
}

/**
 * Copies a single file, creating destination directories as needed.
 * @param sourcePath - absolute path to the source file
 * @param destPath - absolute path to the destination file
 */
export const copyFile = async ({ sourcePath, destPath }: Params) => {
	...
};
```

Individual properties within a Params interface may still have their own `/** */` comments when the property name and type alone don't convey the contract — apply the same "why is non-obvious" threshold as everywhere else.

## Style Rules

1. **Be concise** – One or two sentences for descriptions. Don’t repeat what the code shows.
2. **Use sentence fragments** – Start `@param` with lowercase, no period needed for single phrases.
3. **Focus on "why" over "what"** – The code shows what it does; explain why someone would use it.
4. **Don't document the obvious**

❌ **BAD: Adds no value**

```typescript
/** The user's name */
name: string;
```

✅ **GOOD: Explains business context**

```typescript
/** Display name shown in the UI, may differ from username */
name: string;
```

5. **Document interfaces and types at the type level**, not every property

```typescript
/**
 * Configuration for the API client.
 */
interface ApiConfig {
	baseUrl: string;
	timeout: number;
	retryStrategy?: RetryStrategy;
}
```

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
 * Useful for network requests or other operations that may fail transiently.
 *
 * @param fn - Async function to retry
 * @param maxAttempts - Maximum number of attempts before giving up
 * @param baseDelay - Initial delay in ms, doubles after each failure
 * @throws {RetryExhaustedError} When all retry attempts fail
 *
 * @example
 * const data = await retry({ fn: () => fetch('/api/data'), maxAttempts: 3 });
 */
export const retry = async <T>({ fn, maxAttempts = 3, baseDelay = 1000 }: Params<T>): Promise<T> => {
	...
};
```
