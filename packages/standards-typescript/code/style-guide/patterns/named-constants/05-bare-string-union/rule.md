---
summary: "a string-literal union exported with no `const` object behind it"
checked: true
severity: advisory
---

## Use a union type paired with a `const` object

For a set of named string values, use a **union type** backed by a `const` object. The `const` object is the single source of truth; the union is derived from it. Consumers reference the object (`Action.Add`), never raw string literals.

✅ GOOD: `const` object + derived union

**`common/constants/Action.ts`**

```typescript
export const Action = {
	Add: 'add',
	Remove: 'remove',
	List: 'list',
	Update: 'update',
} as const;

export type Action = (typeof Action)[keyof typeof Action];
```

```typescript
// consumer — references the object, not a raw string
doThing(Action.Add);
```

❌ BAD: bare union, values redefined at every call site

```typescript
export type Action = 'add' | 'remove' | 'list' | 'update';

// consumers retype raw literals — the source of truth is now "everywhere"
doThing('add');
```
