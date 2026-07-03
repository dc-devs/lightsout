# Folder Structure

Use a `common/` folder pattern to organize shared code — it keeps related code local, makes dependency scope visible at a glance, and scales by promoting code upward only when reuse is proven.

The folder trees in this document describe **folder-modules** — see [Modules & the Graduation Rule](./architecture-decisions.md#modules--the-graduation-rule). A feature folder is a module: its `index.ts` is the public API, and everything under its `common/` is internal.

## Rules

1. **Keep `common/` close to consumers** – Place it at the lowest level where all dependent code can access it
2. **Promote when reused** – Only move code to a parent `common/` when 2+ modules at that level need it
3. **Avoid circular dependencies** – When moving code up, update all import paths and verify no cycles are created
4. **Organize by type** – Use subdirectories like `utils/`, `types/`, `services/` within `common/`
5. **Graduate, don't pre-build** – A concept starts as a single file and becomes a folder only when it needs private companions. Never create folder ceremony for a one-file concept

## Folder Naming

Folders follow the same **match-the-name** principle as files: a folder is named after what it holds, in that name's own casing.

- **Category and container folders** – `camelCase`. This covers the `common/` subfolders (`utils/`, `types/`, `constants/`), domain folders (`formatting/`, `validation/`), and feature/screen folders (`apiTokens/`, `featureA/`). Single-word folders (`utils/`, `types/`) read identically either way.
- **A folder that graduated from a single named item** – takes that item's name *and casing*. A class or component folder is therefore `PascalCase` (`HttpClient/`, `IssuePanel/`), matching the `HttpClient.ts` / `IssuePanel.tsx` it grew from. This keeps the name stable through graduation — the container never disagrees with its contents.

**Resolve casing in this order** (same as [file naming](../../fdrop:code:style-guide/references/conventions/file-naming.md)):

1. **An established convention in the directory** – match what neighboring folders already use
2. **The package's framework doc** – e.g., NestJS uses `kebab-case` throughout, and route segments that map to URLs are `kebab-case`; defer to the framework where it mandates a casing
3. **Default** – `camelCase`, or `PascalCase` for a folder graduated from a PascalCase item, per the rule above

| Folder      | Contents                                 | Example                         |
| ----------- | ---------------------------------------- | ------------------------------- |
| `utils/`    | Stateless pure functions                 | `formatDate()`, `parseString()` |
| `services/` | Stateful classes/singletons with methods | `ImageCache`, `ApiClient`       |

**Rule of thumb:** If it holds state and has methods that operate on that state, it's a service (class). If it's a pure function with no side effects, it's a utility.

## Domain Folders

When `utils/` grows, group related functions into **domain-named folders** as siblings of `utils/`.

**Rule:** A pure function starts in `utils/`. When a second related function with a shared domain appears, both graduate to a named domain folder at the same level as `utils/`.

| Criteria | Result |
|----------|--------|
| 1 ungrouped pure function | stays in `utils/` |
| 2+ related pure functions with a shared domain | domain folder (sibling of `utils/`) |
| Stateful code with methods | stays in `services/` |
| 1 function alone | never gets its own domain folder |

The domain name should describe the cohesion — e.g., `formatting/`, `validation/`, `parsing/`, `stepConfigs/`.

```
common/
├── utils/              # Ungrouped pure functions (the default)
├── types/
├── services/
├── formatting/         # Domain folder: 2+ related pure functions
│   ├── formatDate.ts
│   ├── formatCurrency.ts
│   └── index.ts
├── validation/         # Another domain folder
│   ├── validateEmail.ts
│   ├── validatePhone.ts
│   └── index.ts
```

## Example Structure

```
src/
├─ common/ # Shared across ALL modules
│ ├─ utils/
│ │ ├─ index.ts
│ │ └─ formatDate.ts
│ ├─ types/
│ │ ├─ index.ts
│ │ └─ ApiResponse.ts
│ ├─ services/
│ │ ├─ index.ts
│ │ └─ ApiClient.ts
│
├─ featureA/
│ ├─ common/ # Shared within featureA only
│ │ ├─ utils/
│ │ │ ├─ index.ts
│ │ │ └─ featureAHelper.ts
│ │ ├─ types/
│ │ │ ├─ index.ts
│ │ │ └─ FeatureAOptions.ts
│ ├─ featureA.ts
│ └─ index.ts
│
├─ featureB/
│ ├─ common/ # Shared within featureB only
│ │ ├─ utils/
│ │ │ ├─ index.ts
│ │ │ └─ featureBHelper.ts
│ ├─ featureB.ts
│ └─ index.ts
```

### Reading the hierarchy

- `src/common/` → Used by **both** `featureA/` and `featureB/`
- `src/featureA/common/` → Used **only** within `featureA/`
- If `featureAHelper.ts` is later needed by `featureB`, promote it to `src/common/utils/`

## Cross-Package Sharing (`packages/shared/`)

When code is needed by 2+ packages, it belongs in a shared package (e.g., `packages/shared/`) — not duplicated in each package's `common/` folder.

### When to use `packages/shared/`

- The code is needed by 2+ packages
- It has zero framework dependencies (no React, NestJS, Prisma, etc.)
- It defines a contract both sides must agree on (constants, error codes, pure predicates)

### When NOT to use `packages/shared/`

- Only one package needs it — use that package's `common/` folder
- It imports a framework — wrap the shared primitive locally instead
- It's an implementation detail (hooks, guards, resolvers, components)

### Pattern: shared primitive + local wrapper

`packages/shared/` exports pure logic. Each consuming package wraps it with framework-specific code in its own `common/` folder.

```
packages/shared/src/permissions/utils/hasPermission.ts      ← pure function
packages/frontend/src/common/permissions/useHasPermission.ts ← React hook wrapping it
packages/api/src/auth/guards/                                ← NestJS guard using it
```
