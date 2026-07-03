# Constant Placement

Constants are NOT types or interfaces. They live in `common/constants/` (`export const …`). A `const` object with its derived union and lookup map lives in `constants/` under the object's name.

✅ GOOD: Constant in constants folder

**`common/constants/defaultConfig.ts`**

```typescript
import type { Config } from '@/path/to/common/types/Config';

export const defaultConfig: Config = {
	name: 'default',
};
```

❌ BAD: Constant in types folder

**`common/types/defaultConfig.ts`**

```typescript
export const defaultConfig = {}; // CONSTANTS DON'T GO IN TYPES
```
