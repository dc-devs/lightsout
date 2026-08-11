---
summary: "a file whose name does not match its export, or a test kept away from the file it tests"
checked: false
severity: advisory
---

## Naming & Test Placement

- Files: name matches the export, including casing ([file-naming.md](../style-guide/conventions/file-naming.md)); framework mandates override.
- Folders: container/category folders are `camelCase`; a folder graduated from a class or component takes that item's PascalCase name; framework mandates override ([folder-structure.md](./folder-structure.md#folder-naming)).
- Test files live adjacent to the file they test — never in separate `__tests__/` directories.
