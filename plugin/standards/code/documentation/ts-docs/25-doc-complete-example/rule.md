---
summary: "a doc comment that does not read like the worked example this section gives"
checked: false
severity: advisory
---

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
