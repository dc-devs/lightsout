---
summary: "a function that only renames parameters or forwards to another"
checked: false
severity: advisory
---

## Anti-Patterns to Avoid

### Thin Wrapper Functions

Don't create functions that only rename parameters or forward to another function:

```typescript
// ❌ adds nothing but indirection
export const buildBrowserLabel = ({ browser, browserVersion }) =>
	buildVersionedLabel({ name: browser, version: browserVersion });

// ✅ call the underlying function directly at the call site
```

A wrapper IS justified when it adds real validation/transformation, meaningfully simplifies a complex API, or handles errors/defaults.

### Delegation to a held collaborator is not a thin wrapper

A class that holds a collaborator instead of extending one — the remedy the
composition-over-inheritance rule requires — reaches it through one-line methods
that forward unchanged. Those methods are the seam that rule asks for, not
indirection to delete:

```typescript
// ✅ the composition remedy: the sharing is visible at the seam
export class RefactorRun {
	private readonly runState: RunState;

	update({ patch }: { patch: Partial<RunManifest> }): Promise<void> {
		return this.runState.update({ patch });
	}
}
```

Deleting them means publishing the held value so callers can reach through it,
and a caller that can reach through it can also step around a sibling method that
adds something — a timer, a counter, a progress line — on the same call. The
forward is what keeps the class's surface the only way in.

This carve-out covers a class delegating to something it holds, and nothing else.
A free function that only forwards to another free function is still a thin
wrapper.
