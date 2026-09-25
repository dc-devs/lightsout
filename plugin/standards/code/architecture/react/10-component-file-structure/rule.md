---
summary: "a folder created for a component that bundles no utilities, types or constants"
checked: false
severity: advisory
---

## Component File Structure

The [graduation rule](../../folder-structure/55-ungrouped-domain-utils/rule.md)
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
│   └── InstallPanel.tsx
```

The folder's inside is the ordinary
[fractal skeleton](../../folder-structure/40-fractal-skeleton/rule.md):
companions live under `common/`, and callers import the component from
`InstallPanel/InstallPanel.tsx` itself — a folder carries no `index.ts`
([folder-index-file rule](../../../style-guide/structure/module-api/25-folder-index-file/rule.md)).
A folder holding only `Component.tsx` bundles nothing and should be the single file —
the [single-file folder rule](../../folder-structure/60-single-file-domain-folder/rule.md),
applied to a component.
