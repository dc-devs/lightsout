---
summary: "a framework wrapper pushed into the shared package instead of kept beside its consumers"
checked: false
severity: advisory
---

**Pattern — shared primitive + local wrapper:**

```
packages/shared/src/permissions/utils/hasPermission.ts        ← pure function
packages/frontend/src/common/permissions/useHasPermission.ts  ← React hook wrapping it
packages/api/src/auth/guards/                                 ← NestJS guard using it
```
