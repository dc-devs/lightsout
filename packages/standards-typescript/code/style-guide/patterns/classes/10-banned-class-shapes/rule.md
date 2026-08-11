---
summary: "a class that is only static members, or one stateless method"
checked: true
severity: advisory
---

**Banned:**

- **Static-only classes** — a module wearing a costume; it adds `ClassName.` prefixes and binds no state. Use module functions (each exported function in its own file).
- **One-method stateless classes** — `class ReportGenerator { execute() }` is a function with a hat on. Write the function.
