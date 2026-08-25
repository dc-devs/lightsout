---
summary: "two or more related JSX-producing functions left ungrouped in `utils/`"
checked: false
severity: advisory
---

## Domain Folders

The [graduation rule](../../folder-structure/55-domain-graduation/rule.md)
applied to JSX-producing helpers: two or more functions sharing a subject
graduate out of `utils/` into a named domain folder, exactly as pure functions
do.

```
common/
├── utils/                         # Ungrouped pure functions
├── stepConfigs/                   # ✅ Domain folder — 2+ related JSX config builders
│   ├── getDesignStepConfig.tsx
│   ├── getInstallStepConfig.tsx
│   └── getStepContentConfig.tsx
├── cellRenderers/                 # ✅ Domain folder — 2+ related JSX renderers
│   ├── renderStatusCell.tsx
│   └── renderDateCell.tsx
```

A domain folder is a grouping, not a module: it carries no `index.ts`
([a domain folder is not a module](../../folder-structure/65-domain-folder-is-not-a-module/rule.md)),
and under `common/` the
[common-barrel rule](../../../style-guide/structure/module-api/30-path-common-barrel/rule.md)
bans one outright.
