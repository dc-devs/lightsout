---
summary: "module-internal shared code leaking out of its module's common/"
checked: true
severity: blocking
---

## Rules

1. **Keep `common/` close to consumers** — the lowest level where all dependents can reach it
2. **Promote when reused** — move to a parent `common/` only when 2+ modules at that level need it
3. **Avoid circular dependencies** — update imports when promoting; verify no cycles
4. **`common/` is always typed, never flat** — every file lives under a type subfolder from the first file. The type vocabulary is a closed list: `utils/`, `types/`, `constants/`, `services/`, plus domain folders graduated per [Domain Folders](#domain-folders). Never invent a new type folder; never place a file directly in `common/`.
5. **Graduate, don't pre-build** — a *concept* becomes a folder only when it needs private companions. This ceremony ban does not apply to `common/`'s type subfolders: that skeleton is always built, so placement is a no-decision.

| Folder | Contents |
| ----------- | ---------------------------------------- |
| `utils/` | Stateless functions — pure or IO-performing (`formatDate()`, `loadConfig()`) |
| `types/` | Type-level declarations (`CopyResult`) |
| `constants/` | Value and named constants (`defaultConfig`, `Action`) |
| `services/` | Stateful classes with methods (`ApiClient`) |

## Example

```
src/
├─ common/            # shared across ALL modules
│  ├─ utils/          #   (formatDate.ts — no barrels under common/)
│  ├─ types/
│  ├─ services/
│  ├─ formatting/     # domain folder: 2+ related pure functions
├─ featureA/
│  ├─ common/         # shared within featureA only
│  │  ├─ utils/
│  │  ├─ types/
│  ├─ featureA.ts
│  └─ index.ts
```

Reading the hierarchy: `src/common/` serves every feature; `src/featureA/common/` serves only `featureA`. If a helper there is later needed by `featureB`, promote it to `src/common/utils/`.
