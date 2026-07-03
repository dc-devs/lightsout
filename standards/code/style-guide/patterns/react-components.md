# Component & Hook Patterns

## React - Function Size Limits

The base function size thresholds are defined in `code:style-guide/references/patterns/functions.md`. The overrides below apply to the file types they specify — when a file matches a classification here, use these thresholds instead of the base.

### File Classification

- `.tsx` files with a named/default export returning JSX → **Component** (use component thresholds)
- `.ts` files exporting a function starting with `use` → **Hook** (use hook thresholds)
- Everything else → **Utility** (50-line threshold applies)

### Line Counting

Count from function signature to closing brace. Exclude imports, type declarations outside the function, and file-level comments.

### Components (.tsx)

| Lines   | Assessment                                                         |
| ------- | ------------------------------------------------------------------ |
| <100    | Almost always fine                                                 |
| 100–150 | Review — acceptable if mostly JSX composition with no inline logic |
| 150+    | Likely needs extraction                                            |
| 200+    | Definitely needs extraction                                        |

### Hooks (.ts)

| Lines  | Assessment                               |
| ------ | ---------------------------------------- |
| <80    | Fine                                     |
| 80–120 | Review — look for extractable pure logic |
| 120+   | Likely needs utility extraction          |
| 160+   | Definitely needs extraction              |

Pure logic inside hooks should be extracted to utility functions. The hook itself should compose, not compute.

## Default Actions — Components & Hooks

| Issue Type                              | Default Action                   | Review Level |
| --------------------------------------- | -------------------------------- | ------------ |
| Component >200 lines                    | Extract sub-components           | Medium       |
| Hook >160 lines                         | Extract pure logic to utilities  | Medium       |
| Inline styles / repeated className logic | Extract to shared class or component | Low          |
