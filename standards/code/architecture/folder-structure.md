# Folder Structure

Use a `common/` folder pattern for shared code — it keeps related code local, makes dependency scope visible, and scales by promoting code upward only when reuse is proven. The trees below are **folder-modules** (see [Modules & the Graduation Rule](./architecture-decisions.md#modules--the-graduation-rule)): a feature folder's `index.ts` is its public API; everything under its `common/` is internal.

## Rules

1. **Keep `common/` close to consumers** — the lowest level where all dependents can reach it
2. **Promote when reused** — move to a parent `common/` only when 2+ modules at that level need it
3. **Avoid circular dependencies** — update imports when promoting; verify no cycles
4. **`common/` is always typed, never flat** — every file lives under a type subfolder from the first file. The type vocabulary is a closed list: `utils/`, `types/`, `constants/`, `services/`, plus domain folders graduated per [Domain Folders](#domain-folders). Never invent a new type folder; never place a file directly in `common/`.
5. **Graduate, don't pre-build** — a *concept* becomes a folder only when it needs private companions. This ceremony ban does not apply to `common/`'s type subfolders: that skeleton is always built, so placement is a no-decision.

| Folder | Contents |
| ----------- | ---------------------------------------- |
| `utils/` | Stateless functions — pure or IO-performing (`formatDate()`, `loadConfig()`) |
| `types/` | Type-level declarations (`CopyResult`) |
| `constants/` | Value and named constants (`defaultConfig`, `Action`) |
| `services/` | Stateful classes with methods (`ApiClient`) |

## What Lives in `common/` — the Barrel-Omission Test

`common/` holds shared **file-modules only**: single-file primitives (a stateless function, a type, a constant, one service class) filed under their type subfolder. It never contains folder-modules.

A shared concept must leave `common/` and become a module — a sibling of the features that use it — the moment it has private internals. The mechanical test: **write the concept's would-be barrel. Does it omit anything?**

- Everything would be exported → it is a bag of primitives → its files go in `common/<type>/` (or a domain folder)
- The barrel would hide something → it is a module with a boundary worth enforcing → module with its own `index.ts`

This keeps placement closed under growth: shared code is either a primitive (`common/`) or a module (a domain sibling) — there is no third place.

## Top Level Is Domain Nouns

`src/`'s top level names domains (`billing/`, `issues/`, `sync/`) — capabilities the product has. Infrastructure capabilities are domains too: `git/`, `config/`, `runState/` are valid module names. Navigation is by domain first, for humans and agents alike.

**Banned module names — a closed list, not a judgment call.** A folder is never named for the *role* of the code it holds: `helpers/`, `utils/`\*, `lib/`, `core/`, `misc/`, `shared/`, `services/`\*, `controllers/`, `models/`, `hooks/`, `components/`, `types/`\*, `constants/`\* (\* legal inside `common/` per its closed list). Where the package's framework doc mandates one of these names (NestJS layout, React feature `components/`, file-based routers), the framework doc wins — the same carve-out as folder casing below. The only privileged folder name at any level is `common/`.

## Growing Without New Rules

At every level exactly three kinds of things exist: **modules**, **`common/`**, and **files**. Growth never invents a new kind of place — it is always one of two mechanical moves:

- **Graduate** — a file needs private companions → it becomes a module ([the graduation rule](./architecture-decisions.md#modules--the-graduation-rule))
- **Consolidate** — a level holds more than ~20 modules → group related sibling modules under a new parent domain module (recursive: a module within a module, each keeping its own barrel)

Consolidation is the census remedy: when a level starts reading like a directory listing instead of a product description, the fix is a parent domain — never a technical-layer bucket.

## Fractal Skeleton

Every graduated feature folder shares one internal shape — its main file, `index.ts`, and (when needed) `common/`. No feature invents its own layout.

## Per-Folder READMEs

A folder gets a `README.md` only for a genuine invariant not derivable from these rules (e.g. "everything here runs in the widget sandbox — no DOM globals"). Never prose restating the structure.

## Folder Naming

Folders match what they hold, in that name's own casing:

- **Category/container folders** — `camelCase` (`utils/`, `types/`, `formatting/`, `apiTokens/`)
- **A folder graduated from a single named item** — that item's name and casing: class/component folders are `PascalCase` (`HttpClient/`, `IssuePanel/`)
- **Resolve casing in order:** (1) established convention in the directory, (2) the package's framework doc (NestJS is `kebab-case` throughout; URL-mapped route segments are `kebab-case`), (3) the defaults above.

## Domain Folders

A stateless function starts in `utils/`. When a second related function with a shared domain appears, both graduate to a named domain folder (sibling of `utils/`) — `formatting/`, `validation/`, `parsing/`. One function alone never gets a domain folder; stateful code stays in `services/`.

A domain folder is **not** a module — by the barrel-omission test it hides nothing: every file in it is public, and its `index.ts` is convenience, not a boundary. The moment a domain folder needs a private file, it has become a module and moves out of `common/`.

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

A pure-contracts/shared package — one where everything is public by design —
is a `common/`-like space: its `src/` holds **domain folders**, not modules.
The barrel-omission test computes this per folder (a barrel that hides
nothing → domain folder, no boundary), which is also how the scanner
classifies it.

**Use `packages/shared/` when:** 2+ packages need it, it has zero framework dependencies, and it defines a contract both sides agree on (constants, error codes, pure predicates).

**Don't when:** one package needs it (use its `common/`), it imports a framework (wrap the shared primitive locally), or it's an implementation detail (hooks, guards, resolvers).

**Pattern — shared primitive + local wrapper:**

```
packages/shared/src/permissions/utils/hasPermission.ts        ← pure function
packages/frontend/src/common/permissions/useHasPermission.ts  ← React hook wrapping it
packages/api/src/auth/guards/                                 ← NestJS guard using it
```
