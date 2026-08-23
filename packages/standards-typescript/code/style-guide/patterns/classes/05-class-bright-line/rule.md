---
summary: "a class written where none of the four criteria that license one hold"
checked: false
severity: advisory
---

## When to Use a Class — The Bright Line

Default to functions. Create a class **if and only if at least one** of these is true:

| # | Criterion | Example |
|---|-----------|---------|
| a | **Mutable state persists across method calls** | `RateLimiter` (remaining tokens), a cache, a connection pool |
| b | **3+ operations share injected config/dependencies** | `HttpClient` (baseUrl, retries, credentials injected once, used by every method) |
| c | **Multiple implementations of a shared interface** | `FileSource` / `S3Source` behind one `RecordSource` contract |
| d | **The framework requires it** | NestJS services, resolvers, guards (DI needs classes) |

If none apply: **functions in a module.** Gut-check: *is "how many of these exist right now?" a meaningful question?* Two `HttpClient`s pointed at different APIs — meaningful → class. Two `formatDate`s — nonsensical → function.

## Functional vs Class-Based

Prefer functions by default. Create a class only per the bright-line criteria in [classes.md](../style-guide/patterns/classes.md#when-to-use-a-class--the-bright-line) (persistent state, 3+ operations sharing injected deps, interface polymorphism, framework mandate). Static-only classes are banned.
