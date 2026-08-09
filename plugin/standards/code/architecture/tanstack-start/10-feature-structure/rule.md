---
summary: "a feature folder that does not follow the TanStack Start layout"
checked: false
severity: advisory
---

## Feature Structure

Each feature in `src/features/` follows this pattern:

```
features/{feature}/
├── common/                    # Feature-wide shared code
│   ├── constants/
│   ├── types/
│   └── utils/
├── components/                # Feature-wide reusable components
├── hooks/                     # Feature-specific React hooks
├── queries/                   # TanStack Query options
├── screens/                   # Screen components (route destinations)
│   └── {ScreenName}/
│       ├── components/        # Screen-specific components
│       │   └── common/        # Shared across screen components
│       ├── hooks/             # Screen-specific hooks
│       ├── {ScreenName}.tsx
│       └── index.ts
├── serverFns/                 # TanStack server functions
└── index.ts                   # Feature barrel export
```
