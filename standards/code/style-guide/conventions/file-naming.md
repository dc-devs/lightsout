# File Naming

The file name always matches the **exported item's name, including its casing** (see the table below). Resolve the casing in this order:

1. **Existing files in the same directory** — match their convention
2. **The package's framework doc** — e.g., NestJS packages use `kebab-case.{suffix}.ts` (see the architecture skill's framework docs)
3. **Default** (new/empty directory, no framework rule): match the export name's own casing per the rule above

| Convention                          | Applies to                                  | Example                                |
| ----------------------------------- | ------------------------------------------- | -------------------------------------- |
| camelCase matching the export name  | functions, value constants                  | `buildVersionedLabel.ts`, `maxRetries.ts` |
| PascalCase matching the export name | classes, interfaces, types, named constants | `UserProfile.ts`, `Action.ts`          |
| kebab-case (framework-mandated)     | per framework doc                           | `get-frontend-domain.ts`               |

**Framework mandates override casing entirely** — e.g., NestJS services are `events.service.ts` even though the class itself is PascalCase.
