---
summary: "an oversized function defended as orchestration while it still holds inline business logic"
checked: false
severity: advisory
---

**Exception — orchestration functions** may exceed 50 lines when each step delegates to a dedicated function (no inline business logic) and the flow is linear: a 150-line `start()` calling 8 step functions is fine; a 150-line function with inline loops and transformations is not.
