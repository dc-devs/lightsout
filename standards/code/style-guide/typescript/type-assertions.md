# Type assertions (`as`)

Avoid `as` casts. They tell the compiler to trust you instead of proving the type is correct.

- Prefer type narrowing with `typeof`, `instanceof`, or discriminated unions.
- If an assertion is truly necessary (e.g., a library returns `unknown`), add a brief comment explaining why narrowing is not possible.

✅ GOOD: Narrowing

```typescript
if (typeof value === 'string') {
	return value.toUpperCase();
}
```

❌ BAD: Assertion without justification

```typescript
return (value as string).toUpperCase();
```
