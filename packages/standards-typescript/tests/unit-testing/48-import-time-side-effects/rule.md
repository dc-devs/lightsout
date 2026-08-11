---
summary: "a module that acts at import time tested without a fresh instance or its own environment"
checked: false
severity: advisory
---

### Import-Time Side Effects

- Use **`jest.isolateModules`** when the module acts at import time (reads `document.currentScript`, checks globals): each call gets a fresh module instance, so per-test state changes take effect on the next require inside the isolate block.
- Branches unreachable in the default `jsdom` environment (e.g., SSR guards on `typeof window`) get a **separate test file** with a `/** @jest-environment node */` docblock, named to distinguish it (`autoInitInBrowser.ssr.unit.test.ts`).
