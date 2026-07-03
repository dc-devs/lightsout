# React Architecture

Architecture decisions for React packages.

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

## File Naming Conventions

| File type | Convention | Example |
|-----------|------------|---------|
| Components | `PascalCase.tsx` (or `PascalCase/` folder) | `IssueDetailContent.tsx`, `IssueDetail/` |
| Hooks | `camelCase.ts` | `useIssues.ts`, `useUpdateIssue.ts` |
| Utils | `camelCase.ts` | `buildOrderBy.ts`, `formatDate.ts` |
| Named constants, interfaces | `PascalCase.ts` | `QueryKey.ts`, `FilterOption.ts` |
| Constants | `camelCase.ts` | `emailRegex.ts`, `defaultPaginationPage.ts` |
| Folders (domain) | `camelCase` | `hooks/`, `components/`, `queries/` |
| Folders (component) | `PascalCase` | `IssueDetail/`, `IssueHeaderToolbar/` |
