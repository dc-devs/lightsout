# Folder Structure

Use a `common/` folder pattern for shared code — it keeps related code local, makes dependency scope visible, and scales by promoting code upward only when reuse is proven. The trees below are **folder-modules** (see [Modules & the Graduation Rule](./architecture-decisions.md#modules--the-graduation-rule)): a feature folder's `index.ts` is its public API; everything under its `common/` is internal.

## Rules

1. **Keep `common/` close to consumers** — the lowest level where all dependents can reach it
2. **Promote when reused** — move to a parent `common/` only when 2+ modules at that level need it
3. **Avoid circular dependencies** — update imports when promoting; verify no cycles
4. **Organize by type** — `utils/`, `types/`, `services/` subfolders inside `common/`
5. **Graduate, don't pre-build** — a concept becomes a folder only when it needs private companions

| Folder | Contents |
| ----------- | ---------------------------------------- |
| `utils/` | Stateless pure functions (`formatDate()`) |
| `services/` | Stateful classes with methods (`ApiClient`) |

## Folder Naming

Folders match what they hold, in that name's own casing:

- **Category/container folders** — `camelCase` (`utils/`, `types/`, `formatting/`, `apiTokens/`)
- **A folder graduated from a single named item** — that item's name and casing: class/component folders are `PascalCase` (`HttpClient/`, `IssuePanel/`)
- **Resolve casing in order:** (1) established convention in the directory, (2) the package's framework doc (NestJS is `kebab-case` throughout; URL-mapped route segments are `kebab-case`), (3) the defaults above.

## Domain Folders

A pure function starts in `utils/`. When a second related function with a shared domain appears, both graduate to a named domain folder (sibling of `utils/`) — `formatting/`, `validation/`, `parsing/`. One function alone never gets a domain folder; stateful code stays in `services/`.

## Example

```
src/
├─ common/            # shared across ALL modules
│  ├─ utils/          #   (index.ts + formatDate.ts)
│  ├─ types/
│  ├─ services/
│  ├─ formatting/     # domain folder: 2+ related pure functions
├─ featureA/
│  ├─ common/         # shared within featureA only
│  │  ├─ utils/
│  │  ├─ types/
│  ├─ featureA.ts
│  └─ index.ts
```

Reading the hierarchy: `src/common/` serves every feature; `src/featureA/common/` serves only `featureA`. If a helper there is later needed by `featureB`, promote it to `src/common/utils/`.

## Cross-Package Sharing (`packages/shared/`)

Code needed by 2+ packages belongs in a shared package — not duplicated per-package.

**Use `packages/shared/` when:** 2+ packages need it, it has zero framework dependencies, and it defines a contract both sides agree on (constants, error codes, pure predicates).

**Don't when:** one package needs it (use its `common/`), it imports a framework (wrap the shared primitive locally), or it's an implementation detail (hooks, guards, resolvers).

**Pattern — shared primitive + local wrapper:**

```
packages/shared/src/permissions/utils/hasPermission.ts        ← pure function
packages/frontend/src/common/permissions/useHasPermission.ts  ← React hook wrapping it
packages/api/src/auth/guards/                                 ← NestJS guard using it
```
