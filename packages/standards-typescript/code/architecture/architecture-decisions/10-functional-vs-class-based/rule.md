---
summary: "a class where none of the four bright-line criteria applies"
checked: false
severity: advisory
---

## Functional vs Class-Based

Prefer functions by default. Create a class only per the bright-line criteria in [classes.md](../style-guide/patterns/classes.md#when-to-use-a-class--the-bright-line) (persistent state, 3+ operations sharing injected deps, interface polymorphism, framework mandate). Static-only classes are banned.
