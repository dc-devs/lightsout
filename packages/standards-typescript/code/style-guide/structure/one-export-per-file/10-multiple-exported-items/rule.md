---
summary: "a second export defended as closely related rather than split out"
checked: false
severity: advisory
---

## Multiple Exported Items — Still Not Negotiable

Invalid rationalizations: "the interface is only used by this constant", "they're closely related", "it's just a small helper" (if it's a helper, make it non-exported — exception 2; if exported, own file).

```typescript
// ❌ config.ts: export interface Config + export const defaultConfig — split them:
// common/types/Config.ts        → export interface Config { ... }
// common/constants/defaultConfig.ts → export const defaultConfig: Config = { ... }
```
