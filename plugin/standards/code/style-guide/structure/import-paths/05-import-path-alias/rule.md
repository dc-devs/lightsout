---
summary: "a relative import path in a package that configures aliases"
checked: true
severity: blocking
---

**Use the package's configured path alias for every import.**

- When a package defines path aliases — in `package.json` → `imports` or in `tsconfig.json` → `compilerOptions.paths` — NEVER use relative paths (`./`, `../`) — not even for sibling files, `common/` subfolders, or barrel re-exports
- Either declaration counts: a package that declares `imports` has configured aliases just as surely as one that declares `paths`
- If a package defines **no** path aliases, use relative paths consistently — and consider adding aliases
- This applies to every file: components, constants, interfaces, types, utils, hooks, etc.

✅ GOOD: Path alias for everything

A package that declares `imports` in `package.json` — the specifier carries its extension:

```typescript
import { ClassName } from '#src/path/to/ClassName.ts';
import { methodName } from '#src/common/utils/methodName.ts';
import { features } from '#src/features/home/components/HomeIssueDetails/common/constants/features.ts';
import { MockIssuePanel } from '#src/features/home/components/HomeIssueDetails/components/MockIssuePanel.tsx';
```

A package that declares `paths` in `tsconfig.json`:

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
