# Naming

## Naming Consistency

Standardize patterns within each domain — if the codebase already uses one, follow it; never introduce a competing convention:

- Data fetching: one of `getData` / `fetchData` / `loadData`, not a mix
- Booleans: consistent prefixes (`is`, `has`, `should`, `can`)
- Event handlers: one pattern (`onSubmit` vs `handleSubmit`)

## Verb Vocabulary (closed)

New code draws function verbs from this closed set — synonyms are how duplicates hide from name-level search (agents and humans both navigate by grep):

`get` · `create` · `update` · `delete` · `format` · `parse` · `validate` · `build` · `to`/`from` (conversions) · `is`/`has`/`should`/`can` (booleans)

Banned synonyms: `fetch`/`load`/`retrieve`/`read` → `get` · `make`/`generate`/`produce` → `create` · `remove` → `delete` · `modify` → `update` · `verify`/`check` → `validate`.

Subordinate to Naming Consistency above: a domain that already standardized on `fetchData` keeps its verb — the vocabulary governs new domains.

## Naming for Reuse

**Name things by what they ARE, never by where or how they're currently used.** The test: could someone use this elsewhere in the app without the name misleading them?

| Category | ❌ Context-specific | ✅ Generic, reusable |
| --- | --- | --- |
| Value constants | `heroMaxWidth` | `maxContentWidth` |
| Utils | `formatPricingDate()` | `formatDate()` |
| Named constants | `HeroButtonVariant` | `ButtonVariant` |
| Components | `PricingPageCard` | `PlanCard` |
| Types | `PricingPageProps` | `PlanCardProps` |

Applies to everything you extract or create. A truly feature-specific value may keep a scoped name — but default to generic: narrowing later is free; renaming a widely-used token is expensive.
