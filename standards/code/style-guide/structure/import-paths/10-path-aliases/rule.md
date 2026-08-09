---
summary: "an alias written from memory instead of read from the package's tsconfig"
checked: false
severity: advisory
---

## Path Aliases

Each package defines its own path aliases in `tsconfig.json` → `compilerOptions.paths`. Common patterns:

| Alias    | Example                                   |
| -------- | ----------------------------------------- |
| `@/*`    | `import { X } from '@/common/utils/X'`    |
| `@src/*` | `import { X } from '@src/common/utils/X'` |

**Rule:** Always check the package's `tsconfig.json` `paths` field to determine the correct alias. Do not hardcode aliases from memory.
