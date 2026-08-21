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

### What this rule is not about

A narrowing site is at fault only when there is a member to reference instead.
Two cases that look the same and are not:

- **A union with no `const` object behind it.** `type Mode = 'fast' | 'slow'` has
  no member to name — declaring one is [bare-string-union]'s ask, and this rule
  has nothing to say until it exists.
- **A value the file may not import.** A standards package ships as a bare
  directory with no `node_modules`, so every value a rule's `check.ts` imports has
  to resolve inside its own package. `input.kind !== 'syntax-tree'` spells the
  literal out because it has no other choice.

`typeof value === 'string'` is not a discriminant either, whatever a const object
elsewhere happens to hold: `typeof` types as the operator's own fixed union.
