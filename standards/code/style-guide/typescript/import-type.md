# Use `import type` for type-only imports

When importing interfaces, types, or anything used only in type positions, use `import type`. This ensures the import is erased at compile time and avoids unnecessary runtime dependencies.

✅ GOOD:

```typescript
import type { UserProfile } from '@/common/types';
import type { UserId } from '@/common/types';
```

❌ BAD:

```typescript
import { UserProfile } from '@/common/types';
import { UserId } from '@/common/types';
```

**Rule:** If the imported symbol is only used in type annotations, parameter types, or generic arguments — use `import type`.
