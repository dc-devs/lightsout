---
summary: "a folder created for a component that bundles no utilities, types or constants"
checked: false
severity: advisory
---

## Component File Structure

The [graduation rule](../../folder-structure/55-domain-graduation/rule.md)
applied to components: a component is a single `.tsx` file until it has private
companions — utilities, types, or constants of its own — and graduates to a
folder only then.

```
components/
├── StatusBadge.tsx                  ✅ Single file (the default)
├── InstallPanel/                    ✅ Graduated: it bundles private companions
│   ├── common/
│   │   └── utils/
│   │       └── getInstallStepLabel.ts
│   ├── InstallPanel.tsx
│   └── index.ts
```

The folder's inside is the ordinary
[fractal skeleton](../../folder-structure/40-fractal-skeleton/rule.md):
companions live under `common/`, which carries no barrel
([common-barrel rule](../../../style-guide/structure/module-api/30-path-common-barrel/rule.md));
the folder's own `index.ts` republishes the component. A folder holding only
`Component.tsx` and `index.ts` bundles nothing and should be the single file —
the [single-file folder rule](../../folder-structure/60-path-domain-folder-single-file/rule.md),
applied to a component.
