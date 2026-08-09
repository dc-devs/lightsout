---
summary: "two or more related JSX-producing functions left ungrouped in `utils/`"
checked: false
severity: advisory
---

## Domain Folders

Domain folders follow the shared rules in [folder-structure.md](../folder-structure.md#domain-folders). React-specific examples include JSX-producing functions grouped by domain:

```
common/
├── utils/                         # Ungrouped pure functions
├── stepConfigs/                   # ✅ Domain folder — 2+ related JSX config builders
│   ├── getDesignStepConfig.tsx
│   ├── getInstallStepConfig.tsx
│   ├── getStepContentConfig.tsx
│   └── index.ts
├── cellRenderers/                 # ✅ Domain folder — 2+ related JSX renderers
│   ├── renderStatusCell.tsx
│   ├── renderDateCell.tsx
│   └── index.ts
```
