---
summary: "a discriminant field typed as a raw string literal instead of the `const` object's member"
checked: false
severity: advisory
---

## Discriminants Use the `const` Object

Discriminant fields in union families reference the `const` object, not raw string literals — otherwise consumers retype the literal at every narrowing site. TypeScript narrows identically.

✅ GOOD:

```typescript
export interface FileAddedEvent {
	kind: typeof SyncEventKind.FileAdded;
	path: string;
}

// consumer — no raw strings
if (event.kind === SyncEventKind.FileAdded) { /* ... */ }
```

❌ BAD:

```typescript
export interface FileAddedEvent {
	kind: 'file-added'; // literal leaks to every consumer call site
}
```
