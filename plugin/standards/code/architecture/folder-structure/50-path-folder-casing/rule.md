---
summary: "a folder whose casing matches none of the doc's three resolutions"
checked: true
severity: advisory
---

## Folder Naming

Folders match what they hold, in that name's own casing:

- **Category/container folders** — `camelCase` (`utils/`, `types/`, `formatting/`, `apiTokens/`)
- **A folder graduated from a single named item** — that item's name and casing: class/component folders are `PascalCase` (`HttpClient/`, `IssuePanel/`)
- **Resolve casing in order:** (1) established convention in the directory, (2) the package's framework doc (NestJS is `kebab-case` throughout; URL-mapped route segments are `kebab-case`), (3) the defaults above.
