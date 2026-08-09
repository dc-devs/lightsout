---
summary: "a folder created for a class that bundles no private companions"
checked: false
severity: advisory
---

## File vs Folder — The Graduation Rule

Classes follow the same graduation rule as everything else (see [architecture-decisions.md](../../architecture/architecture-decisions.md#modules--the-graduation-rule)):

- **A class starts as a single file** — `RateLimiter.ts` with its test beside it; non-exported helpers may co-locate.
- **A class graduates to a folder** — `HttpClient/` — only when it needs private companions (bundled utils, types, or constants that serve only it). Companions live under `common/` by category (`utils/`, `types/`, `constants/`), each with a barrel; the class folder's `index.ts` exports the class and the boundary rule applies.
- Do NOT create a folder for a class with no companions — that is ceremony, not structure.
