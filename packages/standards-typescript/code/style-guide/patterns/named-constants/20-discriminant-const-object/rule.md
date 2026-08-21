---
summary: "a discriminant field typed as a raw string literal instead of the `const` object's member"
checked: true
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

// consumer — no raw strings, whichever way it narrows
if (event.kind === SyncEventKind.FileAdded) { /* ... */ }

switch (event.kind) {
	case SyncEventKind.FileAdded: {
		/* ... */
	}
}
```

❌ BAD:

```typescript
export interface FileAddedEvent {
	kind: 'file-added'; // literal leaks to every consumer call site
}
```
