---
summary: "an exported function with no declared return type"
checked: true
severity: blocking
---

The bright line is the `export` keyword — the same trigger as "own file" and the `Params` interface:

- **Exported function** → declare the return type. The annotation is the output half of the public contract, exactly as `Params` is the input half.
- **Non-exported function** (private helpers, callbacks) → always infer. Annotations on internals are noise; the consumer is in the same file and inference is precise there.

**Why this rule exists:** with inference, an exported function's return type is whatever the body happens to return today. A refactor can silently widen or change the public contract, and the diff reads as an implementation edit — the error surfaces later, in a consumer's file, several inference hops away. An explicit annotation fails at the definition site the moment the body stops satisfying the contract, and an intentional API change becomes a visible diff line. It also keeps the codebase compatible with TypeScript's `isolatedDeclarations`.

✅ GOOD:

```typescript
interface Params {
	user: User | null;
}

export const getUserDisplayName = ({ user }: Params): string => {
	// ...
};

const sumTotals = ({ records }: { records: ReportRecord[] }) => {
	// private helper — inferred
};
```

❌ BAD:

```typescript
export const getUserDisplayName = ({ user }: Params) => { /* ... */ }; // WRONG — exported, contract is implicit

const sumTotals = ({ records }: { records: ReportRecord[] }): number => { /* ... */ }; // WRONG — internal, annotation is noise
```

**Exceptions** (inference is correct on these even when exported):

1. **Generic-heavy signatures** — when the written return type would be an unreadable conditional-type expression, the generic signature is the contract; infer.
2. **Interface-pinned signatures** — methods implementing a declared interface (e.g., a `RecordSource` implementation) are already contracted by the interface; restating the type is duplication.

(Framework-specific exceptions live with their frameworks: the React document exempts components, and the TanStack Start document exempts query-options factories — each loads only for repos using that framework.)

**A non-exported function keeps an annotation when removing it changes what the compiler accepts** — contextual typing of literals (an array of tuples inferring as a wider union), a recursive helper, excess-property checking on an object literal. The bright line stays: annotate exports; do not annotate internals *for documentation*.

**Migration:** new exported functions comply immediately; existing exported functions gain a return type when touched. Never remove a return type from an exported function.
