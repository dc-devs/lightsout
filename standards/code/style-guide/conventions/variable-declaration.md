# Variable Declaration

## Variables

- Always use verbose and readable variable names
- Code should be readable enough that a new developer can understand it without additional documentation
- Avoid single-letter variables except in small loops (`i`, `j`) or well-known conventions (`e` for event)

## Don't Hoist Single-Use Scalars

Don't hoist single-use scalars to module scope or a constants file. If a value is used by one function and isn't a map, declare it inline — `const maxRetries = 10;` inside the method. Promote to a module-level constant (or a `constants/` file) only when (a) it's consumed in 2+ places, or (b) it's a lookup map or structured config.

❌ BAD: hoisted single-use scalar

```typescript
const MAX_RETRIES = 10; // module scope, screaming-snake — and only one caller below

const fetchWithRetry = async () => {
	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) { /* ... */ }
};
```

✅ GOOD: declared inline where it's used

```typescript
const fetchWithRetry = async () => {
	const maxRetries = 10;
	for (let attempt = 0; attempt < maxRetries; attempt++) { /* ... */ }
};
```
