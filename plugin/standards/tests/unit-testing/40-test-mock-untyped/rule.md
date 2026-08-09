---
summary: "a `jest.fn()` with no generic, so the spy does not match the real signature"
checked: true
severity: blocking
---

### Mock Typing Rules

Every `jest.fn()` **must** be fully typed to the real function's signature — read the source first.

```typescript
// ✅ generic matches the real signature (async: include the Promise wrapper)
const mockGetProfile = jest.fn<(params: { userId: string }) => Profile | null>();

// ✅ factory wrapper uses typed parameters — never (...args: unknown[]) (causes TS2556)
jest.mock('@/utils/get-profile', () => ({
	getProfile: (params: { userId: string }) => mockGetProfile(params),
}));
```

Using `() => mockFn()` for a function that takes parameters silently discards arguments — the spy records zero-arg calls and `toHaveBeenCalledWith` fails. Some existing files use `(...args: unknown[])` — that is legacy debt; new tests always type the wrapper.

**Framework-generic results are exempt.** These typing rules pin *your* contracts, not the framework's. When a stub must satisfy a framework's heavily generic result type (TanStack's `UseMutationResult` / `UseQueryResult` and kin), stub only the fields the unit under test reads and cast loosely (`as Record<string, unknown>`, or `as unknown as UseMutationResult<…>` where the full type is demanded) — reproducing the framework's generics in a stub adds noise, not safety.
