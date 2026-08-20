---
summary: "an alias written from memory instead of read from the package's own declaration"
checked: false
severity: advisory
---

## Path Aliases

Each package declares its own path aliases, in `package.json` → `imports` or in `tsconfig.json` → `compilerOptions.paths`. Common patterns:

| Alias | Declared in | Example |
| --- | --- | --- |
| `#src/*` | `package.json` → `imports` | `import { X } from '#src/common/utils/X.ts'` |
| `@/*` | `tsconfig.json` → `paths` | `import { X } from '@/common/utils/X'` |
| `@src/*` | `tsconfig.json` → `paths` | `import { X } from '@src/common/utils/X'` |

**Rule:** Always read the package's own declaration to determine the correct alias. Do not hardcode aliases from memory.

**Gotcha — a package-imports alias resolves its target literally.** `"#src/*": "./src/*"` substitutes the captured text and stops: Node, TypeScript and esbuild do no extension probing on an `imports` target, so the specifier must carry the file extension it resolves to (`#src/runState/summarizeRun.ts`, `#src/cli/index.ts`). An extensionless `#src/cli` names a file that does not exist. A tsconfig `paths` alias is probed the ordinary way, so `@/cli` is correct there.
