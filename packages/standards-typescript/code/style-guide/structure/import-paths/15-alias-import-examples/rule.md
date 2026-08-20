---
summary: "an import that reads unlike the document's worked examples"
checked: false
severity: advisory
---

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
