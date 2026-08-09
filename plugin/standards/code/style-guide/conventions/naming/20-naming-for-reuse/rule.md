---
summary: "a name that says where a value is used rather than what it is"
checked: false
severity: advisory
---

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
