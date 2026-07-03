# Avoid `any`

Do not use `any`. It disables type checking and defeats the purpose of TypeScript.

- Use `unknown` when the type is genuinely not known — then narrow with type guards before using it.
- Use specific types or generics when the structure is known.
- If you must bypass the type system in a rare edge case, add the project's lint-suppression comment with an explanation of why.

✅ GOOD:

```typescript
const parsePayload = ({ raw }: { raw: unknown }) => {
	if (typeof raw === 'string') {
		return JSON.parse(raw);
	}

	throw new Error('Expected string payload');
};
```

❌ BAD:

```typescript
const parsePayload = ({ raw }: { raw: any }) => {
	return JSON.parse(raw);
};
```
