# Naming

## Naming Consistency

Standardize naming patterns within each domain. Pick one convention and use it consistently:

- Data fetching: choose one of `getData` / `fetchData` / `loadData` — not a mix
- Boolean variables: use consistent prefixes (`is`, `has`, `should`, `can`)
- Event handlers: use consistent patterns (`onSubmit`, `handleSubmit` — pick one)

**Rule:** If the codebase already uses a naming pattern for a domain, follow it. Do not introduce a competing convention.

## Naming for Reuse

Think like a principal engineer: every name you create should assume it will be reused in contexts you haven't imagined yet.

**Name things by what they ARE, never by where or how they're currently used.**

The test: "Could someone use this in a completely different part of the app without the name being misleading?" If no, the name is too specific.

| Category | ❌ Bad (context-specific) | ✅ Good (generic, reusable) |
| --- | --- | --- |
| Value constants | `heroMaxWidth`, `pricingCardGap` | `maxContentWidth`, `cardGap` |
| Utils | `formatPricingDate()` | `formatDate()` |
| Named constants | `HeroButtonVariant` | `ButtonVariant` |
| Components | `PricingPageCard` | `PlanCard` |
| Types/Interfaces | `PricingPageProps` | `PlanCardProps` |

This applies to everything you extract or create: constants, utility functions, components, interfaces, and types.

**When extracting code**, always ask:

1. Is this name tied to a specific screen, section, or feature when it doesn't need to be?
2. Does the existing codebase have a naming pattern for this kind of thing?
3. Will this name still make sense if the item moves to `common/` later?

If a value is truly feature-specific and will never be reused, scoping the name is fine. But default to generic — you can always narrow later, but renaming a widely-used token is expensive.
