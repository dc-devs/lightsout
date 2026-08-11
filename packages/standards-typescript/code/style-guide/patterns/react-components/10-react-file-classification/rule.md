---
summary: "a file measured as the wrong kind — a hook read as a utility, a component read as a hook"
checked: false
severity: advisory
---

### File Classification

- `.tsx` files with a named/default export returning JSX → **Component** (use component thresholds)
- `.ts` files exporting a function starting with `use` → **Hook** (use hook thresholds)
- Everything else → **Utility** (50-line threshold applies)
