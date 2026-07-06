# Architecture Decisions

Universal architectural decisions that apply across the codebase.

## Modules & the Graduation Rule

A **module** is a unit of code with a public API and private internals. TypeScript enforces privacy at the file level (non-exported = invisible); folder-level boundaries are convention the repo may enforce with tooling.

**Every concept starts as a file and earns its folder:**

- **File-module (default):** a single file holding one exported item plus non-exported helpers. The compiler enforces the boundary for free.
- **Folder-module (graduated):** when a concept needs private companions — its own utils, types, or constants that serve only it — it graduates to a folder with an `index.ts` as its public API.
- **Born folders:** features, route modules, and screens are inherently multi-file and start as folder-modules.

**The trigger is mechanical:** *needs private companion files → folder; doesn't → file.* Never create folder ceremony for a one-file concept.

**Borderline cases are decided by the barrel-omission test:** write the concept's would-be `index.ts`. Omits nothing → the concept is primitives; its files belong in `common/<type>/`. Hides internals → it is a module. This applies to shared code too: a shared concept with private internals graduates OUT of `common/` into its own module ([folder-structure.md](./folder-structure.md#what-lives-in-common--the-barrel-omission-test)).

**Boundary rules for folder-modules:**

1. Cross-module imports go through the module's `index.ts` **only** — never reach into another module's internals
2. Inside a module, deep imports between its files are correct
3. Tests target the module's public API; internals are covered through it (a `.unit.test.ts` beside a file marks it as a boundary; files under a module's `common/` have none of their own)
4. Test imports obey the same boundary: a test OUTSIDE a module imports its `index.ts`, never its internals — including in repos that keep tests in a separate directory. (A boundary test living beside its file is inside the module; its deep import is correct.)

The rule is recursive — a graduated component folder inside a feature folder is a module within a module.

## Functional vs Class-Based

Prefer functions by default. Create a class only per the bright-line criteria in [classes.md](../style-guide/patterns/classes.md#when-to-use-a-class--the-bright-line) (persistent state, 3+ operations sharing injected deps, interface polymorphism, framework mandate). Static-only classes are banned.

## Code Placement Philosophy

Place shared code at the lowest common ancestor `common/` folder (each package's architecture doc defines the concrete hierarchy):

1. **First:** search whether it already exists in `common/` at any level — if found, use it.
2. **Second:** if not found, start local and promote later — moving code up when reuse is proven beats premature generalization.
3. **When promoting, the destination is decided by the barrel-omission test:** a single-file primitive goes to the ancestor level's `common/<type>/`; a shared concept with private internals becomes its own module at that level. `common/` never contains folder-modules — shared code is a primitive or a module, never a third thing.

Import granularity follows the module boundary rule ([module-api.md](../style-guide/structure/module-api.md#module-boundaries)): deep-import specific files within your own module; import only the `index.ts` across a boundary. Never import from a package-root barrel.

## Naming & Test Placement

- Files: name matches the export, including casing ([file-naming.md](../style-guide/conventions/file-naming.md)); framework mandates override.
- Folders: container/category folders are `camelCase`; a folder graduated from a class or component takes that item's PascalCase name; framework mandates override ([folder-structure.md](./folder-structure.md#folder-naming)).
- Test files live adjacent to the file they test — never in separate `__tests__/` directories.

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

### Unused Code

Delete unused exports, interfaces, types, and functions immediately — version control has history. If unsure whether something is used, search before deciding.

### Premature Abstraction

Wait for 2–3 concrete uses before abstracting. The right abstraction becomes clear with real usage; wrong abstractions are worse than duplication.

### Type Alias Indirection

Don't create a file just to alias another type (`export type FilterOptions = TableFilterState`) — use the original directly; if the semantic distinction matters, a comment at the usage site beats indirection.

### Circular Dependencies

Module A importing B importing A creates fragile load order and breaks tree-shaking. Fix by extracting the shared piece (usually a type) into a third module both import, or restructure per the placement hierarchy.

### Duplicated Patterns & Logic

The same pattern in 2+ files gets extracted to the lowest common ancestor `common/` (loading/error state handling, validation logic, repeated transformations, generic named constants like a `SortDirection` union belong in `src/common/constants/`).

## Barrel Exports (`index.ts`)

A graduated folder-module's `index.ts` is its public API contract — the single import path other modules use. Barrel rules (named re-exports, one export per line, deliberate surface) are defined in [module-api.md](../style-guide/structure/module-api.md#barrel-files-indexts).
