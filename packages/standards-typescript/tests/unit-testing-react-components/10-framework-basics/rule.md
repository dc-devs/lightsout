---
summary: "a component test importing the wrong testing library, extension or interaction helper for the package"
checked: false
severity: advisory
---

## Framework Basics

- Import from `@testing-library/react` (React) or `@testing-library/preact` (Preact) — check the package's `package.json`; the API is identical.
- Component test files use `.unit.test.tsx` (JSX requires `.tsx`), co-located with the component.
- **Framework route/page files never get co-located unit tests** — they are thin wiring (guards, layout, a screen render) verified through e2e tests and the screen component's own tests.
- Interactions use `userEvent` **when the package depends on `@testing-library/user-event`** (check its `package.json`); otherwise use `fireEvent` from the testing-library package. Never add the dependency yourself — that is the repo owner's decision, surfaced by `lightsout doctor`.
