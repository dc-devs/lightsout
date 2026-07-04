# Named Constants

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

## Casing

Named constants are **PascalCase** (`Action`, `LogLevel`) — the `const` object and its derived `type` share one name, and the type must be PascalCase. The file matches: `Action.ts`.

This is distinct from plain **value constants** (a single scalar or config value like `maxRetries`, `emailRegex`), which stay **camelCase**. The test: if it backs a union or has members consumers dot into (`Action.Add`), it's a named constant → PascalCase; if it's a lone value, it's a value constant → camelCase.

## Boundaries

At boundaries (JSON payloads, query params, DB values) incoming strings are not yet the union — convert with a small validation function (e.g., `parseAction`), never with an `as` cast.

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

**Exemption — component prop unions.** A UI component's discriminated `Props` union may use raw string-literal discriminants (`status: 'notInstalled' | 'connected'`): the caller writes the literal once as a JSX attribute, which is idiomatic React and reads better than a constant import. The rule above targets domain values that cross module boundaries and get narrowed at many call sites. If the same discriminant values also appear in domain logic, they are domain values — use the `const` object everywhere, props included.

## Derived Lookup Maps May Co-Locate

A lookup map keyed by the union (`Record<Action, …>`) may live in the same file as the `const` object — the two are tautologically coupled, so every change to one changes the other.

```typescript
export const LogLevel = {
	Debug: 'debug',
	Info: 'info',
	Error: 'error',
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

export const logLevelLabels: Record<LogLevel, string> = {
	[LogLevel.Debug]: 'Debug',
	[LogLevel.Info]: 'Info',
	[LogLevel.Error]: 'Error',
};
```

An unrelated constant that merely *uses* the union goes in `constants/` as usual.
