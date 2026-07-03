# Architecture Decisions

This document outlines universal architectural decisions and patterns that apply across this codebase.

## Modules & the Graduation Rule

A **module** is a unit of code with a public API and private internals. TypeScript enforces privacy at the file level (non-exported = invisible to everyone); folder-level boundaries are a convention the consuming repo may additionally enforce with tooling.

**Every concept starts as a file and earns its folder:**

- **File-module (the default):** a single file holding one exported item plus any non-exported private helpers. The compiler enforces the boundary for free. Examples: a utility function, a small class, a hook.
- **Folder-module (graduated):** when a concept needs private companions — its own utils, types, or constants that serve only it — it graduates to a folder with an `index.ts` as its public API.
- **Born folders:** features, route modules, and screens are inherently multi-file concepts and start as folder-modules.

**The graduation trigger is mechanical:** *needs private companion files → folder; doesn't → file.* Never create folder ceremony for a concept that fits in one file.

**Boundary rules for folder-modules:**

1. Cross-module imports go through the module's `index.ts` **only** — never reach into another module's internals (lint-enforced)
2. Inside a module, deep imports between its files are correct
3. Tests target the module's public API; internals are covered through it (a `.unit.test.ts` next to a file marks it as a public boundary; internals under a module's `common/` have no test files of their own)

The rule is recursive — a graduated component folder inside a feature folder is a module within a module, each with its own boundary.

## Functional vs Class-Based Approaches

**Default Preference: Functional Approach**

Prefer functions by default — they are simpler, more testable, and easier to reason about. Create a class **if and only if at least one** of these is true:

- **Mutable state persists across method calls** (a cache, a connection, accumulated data)
- **3+ operations share injected config/dependencies** (the constructor injects once; every method uses them)
- **Multiple implementations of a shared interface** (polymorphism is the design)
- **The framework requires it** (e.g., NestJS DI)

Static-only classes are banned — they are modules wearing costumes. See [classes.md](../../fdrop:code:style-guide/references/patterns/classes.md#when-to-use-a-class--the-bright-line) for the full rule and examples.

## Code Placement Philosophy

Place shared code at the lowest common ancestor `common/` folder. Each package's architecture doc defines the concrete hierarchy for that package — defer to those for specific scope rules.

When creating or extracting shared code, follow these principles:

1. **First:** Search if it already exists in `common/` at any level
    - If found → **use the existing implementation**

2. **Second:** If not found, start local and promote later
    - It's easier to move code up when reuse is proven
    - Premature generalization creates unused abstractions

**Additional rules:**

- Import granularity follows the module boundary rule (see [module-api.md](../../fdrop:code:style-guide/references/structure/module-api.md#module-boundaries)): **within your own module, deep-import the specific file** (`from '@/common/utils/formatDate'`); **across a module boundary, import the module's `index.ts` only**. Never import from a package-root barrel like `@common`.
- If your project doesn't use path aliases, use relative paths consistently

## File Naming Conventions

**Files** follow the rule in the style guide's [file-naming doc](../../fdrop:code:style-guide/references/conventions/file-naming.md): the filename matches the export name including its casing (camelCase exports → camelCase files, PascalCase exports → PascalCase files), with framework mandates overriding.

**Folders** follow the rule in [folder-structure.md](./folder-structure.md#folder-naming): container and category folders are `camelCase`; a folder that graduated from a single class or component takes that item's PascalCase name; framework mandates (e.g., NestJS, URL-mapped routes) override.

Packages with their own architecture docs may define their own conventions — defer to those docs where they diverge.

## Test File Placement

Test files live adjacent to the file they test — not in separate `__tests__/` directories.

## Anti-Patterns to Avoid

### Thin Wrapper Functions

**Don't create functions that only rename parameters or add no meaningful abstraction.**

```typescript
// ❌ BAD: Thin wrapper that adds no value
export const buildBrowserLabel = ({ browser, browserVersion }) => {
	return buildVersionedLabel({ name: browser, version: browserVersion });
};

// ✅ GOOD: Just use the underlying function directly
const browserLabel = buildVersionedLabel({
	name: visitorSession.browser,
	version: visitorSession.browserVersion,
});
```

**Why this is bad:**

- Adds unnecessary indirection (more files to navigate)
- Makes refactoring harder (more files to update)
- Creates cognitive overhead (readers must trace through layers)
- Violates DRY by duplicating the function signature

**When a wrapper IS justified:**

- It adds meaningful validation or transformation
- It provides a significantly simpler API for a complex underlying function
- It handles error cases or provides defaults

### Unused Code

**Delete unused exports, interfaces, types, and functions immediately.**

- Don't leave dead code "just in case" — version control has history
- Unused code creates confusion about what's actually used
- It adds maintenance burden and clutters search results
- If you're unsure if something is used, search the codebase before deciding

### Premature Abstraction

**Don't create abstractions for hypothetical future use cases.**

- Wait until you have 2–3 concrete uses before abstracting
- The "right" abstraction becomes clear with real usage patterns
- Wrong abstractions are worse than duplication

### Type Alias Indirection

**Don't create separate files just to alias another type.**

**FilterOptions.ts**

```typescript
// ❌ BAD: Unnecessary alias file
export type FilterOptions = TableFilterState;

// ✅ GOOD: Use the original type directly
import type { TableFilterState } from './TableFilterState';
```

If semantic distinction is important, add a comment at the usage site instead of creating indirection.

### Circular Dependencies

Module A imports Module B which imports Module A. This creates fragile load-order dependencies and breaks tree-shaking.

```typescript
// ❌ BAD: order.ts imports customer.ts which imports order.ts
// order.ts
import { Customer } from './customer';
export const getOrderSummary = (order: Order) => ({ ...order, customer: getCustomerName(order.customerId) });
export type Order = { id: string; customerId: string };

// customer.ts
import { Order } from './order'; // circular!
export const getCustomerName = (id: string) => { /* ... */ };
export const getCustomerOrders = (customer: Customer): Order[] => { /* ... */ };

// ✅ GOOD: Extract shared type to a third module
// types.ts
export type Order = { id: string; customerId: string };

// order.ts
import type { Order } from './types';
import { getCustomerName } from './customer';

// customer.ts
import type { Order } from './types';
```

**How to fix:**

- Extract the shared code into a third module that both can import
- Use dependency injection to break the cycle
- Restructure to follow the code placement hierarchy (promote shared code to `common/`)

### Duplicated Patterns & Logic

If the same pattern or logic exists in 2+ files, extract it to a shared location following the Code Placement Philosophy.

Common signs of duplication:

- Loading/error/data state handling repeated across components
- Validation logic copied between forms or files
- Repeated data transformations or API call patterns
- Generic named constants (e.g., a `SortDirection` union with `Asc`/`Desc`) duplicated across features — these belong in `src/common/constants/`

**Where to place:** Start at the lowest common ancestor `common/` folder. Create a shared utility, hook, or component as appropriate.

## Barrel Exports (`index.ts`)

A graduated folder-module's `index.ts` is its public API contract — the single path other modules import through, and how the boundary created by the [graduation rule](#modules--the-graduation-rule) becomes real. The barrel rules (named re-exports, one export per line, deliberate public surface) are defined once in [module-api.md](../../fdrop:code:style-guide/references/structure/module-api.md#barrel-files).

Package-specific additions (e.g., import alias conventions in re-export paths) are documented in each package's architecture doc.
