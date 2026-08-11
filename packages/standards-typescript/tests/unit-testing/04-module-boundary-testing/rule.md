---
summary: "a dedicated test file on something no barrel exports — internals are covered through the boundary"
checked: false
severity: advisory
---

## Module Boundary Testing

Tests target **module boundaries** — a module's public API — not every file individually. Internals are covered *through* the boundary. This pins tests to behavior rather than internal decomposition: refactoring a module's internals never breaks its tests.

**"Public" means reachable through a barrel (`index.ts`), not "has the `export` keyword"** — under one-export-per-file, everything carries `export`; the barrel is the line. The whole doctrine in one sentence: *test what's in the barrels; nothing else gets a test file.* And it holds in both directions — **direct tests are never an exception, they are a promotion**: if a helper's cases deserve direct tests (combinatorial inputs, a contract meaningful to callers who've never seen this module), the helper deserves the barrel first. Reluctance to export it is evidence its cases aren't a contract — cover it through the boundary, or ask whether the uncoverable branches are dead code.

**Classify every source file before writing tests:**

| Classification | Definition | Test file? |
|---|---|---|
| **Boundary** | A module's public surface: shared leaf modules under a root-layer `common/` (e.g., `src/common/utils/`, `src/app/common/`); a feature's public exports (hooks, components, top-level operation files); framework files (`.service.ts`, `.resolver.ts`, `.controller.ts`, guards, job services); a graduated folder's main file (`HttpClient/HttpClient.ts`) | ✅ Co-located `*.unit.test.ts` |
| **Internal** | A file under a *module's* `common/` — i.e., a `common/` whose parent folder is a feature, route, screen, component, or class folder (not a root layer like `src/`) | ❌ No dedicated test file — covered through the owning module's boundary tests |

**Rules:**

- Coverage is still measured per source file: an internal must reach 100% lines/branches/functions, achieved by driving the boundary's inputs.
- If an internal branch cannot be reached through any boundary input, it is **dead code** — flag it for deletion. Do not write a direct test to cover it.
- If covering an internal through the boundary is impractical (combinatorial inputs), that is the promotion signal: the internal has earned its own module and direct tests. Flag it in the report — do not silently create a dedicated test file.
- Existing dedicated test files on internals are migration debt: leave them in place and do not extend them — new coverage goes through the boundary. Flag them in the report as migration candidates.
- A test deep-importing a module internal (a module-boundary scan finding on a test file) is resolved by THIS section's rules, never by a bare import rewrite: barrel-exported target → import through the barrel; internal target → convert the coverage to drive the module's boundary, or — when that is impractical — treat it as the promotion signal above and export the file deliberately.
