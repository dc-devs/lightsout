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

A constant may instead carry its own type beside it under one-export-per-file's exception 5 (`interface Config` + `defaultConfig: Config` in one `constants/` file, named for the value) — use `types/` when the type has any other consumer.
