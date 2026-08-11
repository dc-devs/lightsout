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
