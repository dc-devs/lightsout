---
summary: "a folder created for a component that bundles no utilities, types or constants"
checked: false
severity: advisory
---

## Component File Structure

**Default to single-file components.** Only create a folder when the component requires bundled utilities, types, or constants:

```
components/
├── SimpleComponent.tsx              ✅ Single file (default)
├── ComplexComponent/                ✅ Folder for bundled logic
│   ├── common/
│   │   └── utils/
│   │       ├── index.ts
│   │       └── helperFunction.ts
│   ├── ComplexComponent.tsx
│   └── index.ts
```
