---
summary: "a shared constant filed under `types/` instead of `constants/`"
checked: false
severity: advisory
---

## Constants → `common/constants/`

Constants are not types — they live in `common/constants/` (`export const …`), never in `types/`. A `const` object with its derived union and lookup map lives in `constants/` under the object's name (see [named-constants.md](../patterns/named-constants.md)).

```typescript
// common/constants/defaultConfig.ts
import type { Config } from '@/path/to/common/types/Config';

export const defaultConfig: Config = { name: 'default' };
```
