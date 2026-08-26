---
summary: "a filename that does not match the export it holds"
checked: true
severity: advisory
---

The file name always matches the **exported item's name, including its casing** (see the table below). Resolve the casing in this order:

1. **Existing files in the same directory** — match their convention
2. **The package's framework doc** — e.g., NestJS packages use `kebab-case.{suffix}.ts` (see the [NestJS channel document](../../../../architecture/nestjs/document.md))
3. **Default** (new/empty directory, no framework rule): match the export name's own casing per the rule above

| Convention                          | Applies to                                  | Example                                |
| ----------------------------------- | ------------------------------------------- | -------------------------------------- |
| camelCase matching the export name  | functions, value constants                  | `buildVersionedLabel.ts`, `maxRetries.ts` |
| PascalCase matching the export name | classes, interfaces, types, named constants | `UserProfile.ts`, `Action.ts`          |
| kebab-case (framework-mandated)     | per framework doc                           | `get-frontend-domain.ts`               |

**Framework mandates override the name entirely.** A file router owns every name inside its route directory — `__root.tsx`, `runs.$runId.tsx`, `standards.tsx` — even though each of those files exports one `Route` const. Files under a package's declared router directory (`routes/` for TanStack Router and Remix, `app/` and `pages/` for Next, `app/` for Expo Router) are exempt from this rule for the same reason NestJS's `events.service.ts` is. A framework's convention-resolved entry files are framework-named too — TanStack Start resolves `src/router.tsx` (which exports `getRouter`), `src/server.ts` and `src/client.tsx` by convention, and NestJS resolves `src/main.ts` — so those names are the framework's rather than the export's.

**Framework mandates override casing entirely** — e.g., NestJS services are `events.service.ts` even though the class itself is PascalCase.
