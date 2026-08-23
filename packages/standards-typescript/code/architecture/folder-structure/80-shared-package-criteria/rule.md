---
summary: "a framework-dependent or single-consumer item placed in the shared package"
checked: false
severity: advisory
---

**Use `packages/shared/` when:** 2+ packages need it, it has zero framework dependencies, and it defines a contract both sides agree on (constants, error codes, pure predicates).

**Don't when:** one package needs it (use its `common/`), it imports a framework (wrap the shared primitive locally), or it's an implementation detail (hooks, guards, resolvers).

**Pattern — shared primitive + local wrapper:**

```
packages/shared/src/permissions/utils/hasPermission.ts        ← pure function
packages/frontend/src/common/permissions/useHasPermission.ts  ← React hook wrapping it
packages/api/src/auth/guards/                                 ← NestJS guard using it
```
