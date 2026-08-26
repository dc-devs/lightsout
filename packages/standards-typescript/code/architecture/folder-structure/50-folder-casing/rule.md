---
summary: "a folder whose casing is none of the three the document allows"
checked: true
severity: advisory
---

## Folder Naming

Folders match what they hold, in that name's own casing:

- **Category/container folders** — `camelCase` (`utils/`, `types/`, `formatting/`, `apiTokens/`)
- **A folder graduated from a single named item** — that item's name and casing: class/component folders are `PascalCase` (`HttpClient/`, `IssuePanel/`)
- **Resolve casing in order:** (1) established convention in the directory, (2) the package's framework doc (NestJS is `kebab-case` throughout; URL-mapped route segments are `kebab-case`), (3) the defaults above.

**When the PascalCase folder would case-collide with an existing sibling** (`Markdown/` beside `markdown.d.ts`), the case-collision rule wins — it is correctness, casing is convention. Rename or move the sibling first: it is almost always a companion that belongs inside the new folder, or a declaration file that should be named for what it declares. Never resolve the collision by dropping the folder to camelCase, which would leave the repo with two casing conventions.

