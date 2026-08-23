---
summary: "a class extending anything other than an Error"
checked: true
severity: advisory
---

## Composition Over Inheritance

Never share behavior through `extends`. A base class couples every subclass to its internals: a change to the base silently changes them all, overriding rewires behavior at a distance, and what is shared can only be discovered by reading a second file. Share by composition instead — hold the common part as a value the composer creates and passes in — and state contracts as interfaces (`implements` is not inheritance and stays welcome).

**The one licensed base is `Error`.** Subclassing is the platform's only way to make a typed, `instanceof`-checkable error, so `class RunLockError extends Error` (and error-family chains like `extends HttpError`) are exempt.

**Framework-mandated bases are a judgment carve-out.** When a framework's contract is literally a base class, extending it is the framework's decision, not a design choice — judge, don't contort. A decorated class is treated as framework-owned outright.

**The remedy** is the same move each time: turn the base class into a plain value or factory, have each former subclass hold it, and delegate — `this.runState.update(...)` instead of inheriting `update`. What was `protected` becomes an explicit parameter or a method on the held value, which is the point: the sharing becomes visible at the seam.
