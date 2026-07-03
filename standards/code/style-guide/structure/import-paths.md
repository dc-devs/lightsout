# Import Path Strategy

**Use the package's configured path alias for every import.**

- When a package defines path aliases, NEVER use relative paths (`./`, `../`) — not even for sibling files, `common/` subfolders, or barrel re-exports
- If a package defines **no** path aliases, use relative paths consistently — and consider adding aliases
- This applies to every file: components, constants, interfaces, types, utils, hooks, etc.

## Path Aliases

Each package defines its own path aliases in `tsconfig.json` → `compilerOptions.paths`. Common patterns:

| Alias    | Example                                   |
| -------- | ----------------------------------------- |
| `@/*`    | `import { X } from '@/common/utils/X'`    |
| `@src/*` | `import { X } from '@src/common/utils/X'` |

**Rule:** Always check the package's `tsconfig.json` `paths` field to determine the correct alias. Do not hardcode aliases from memory.

✅ GOOD: Path alias for everything

```typescript
import { ClassName } from '@/path/to/ClassName';
import { methodName } from '@/common/utils/methodName';
import { features } from '@/features/home/components/HomeIssueDetails/common/constants';
import { MockIssuePanel } from '@/features/home/components/HomeIssueDetails/components/MockIssuePanel';
```

❌ BAD: Relative paths in an alias-configured package

```typescript
import { helper } from './helper';
import { util } from '../common/utils/util';
import { features } from './common/constants';
```
