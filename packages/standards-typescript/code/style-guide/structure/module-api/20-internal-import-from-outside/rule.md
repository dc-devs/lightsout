---
summary: "a file inside an `internal/` folder imported from outside the folder that holds it"
checked: true
severity: off
---

## Private Files Live in `internal/`

A folder's private files sit in its `internal/` folder, and only files inside that folder import them. Everything outside `internal/` is the folder's public API.

```
src/ingestion/
├─ ingestRecords.ts        # public — anyone may import it
├─ ingestRecords.unit.test.ts
└─ internal/
   ├─ parseRow.ts          # private to src/ingestion/
   └─ parseRow.unit.test.ts
```

- **Inside the folder:** `src/ingestion/ingestRecords.ts` imports `./internal/parseRow` — correct. So does any test under `src/ingestion/`.
- **Outside it:** `src/reporting/buildReport.ts` importing `../ingestion/internal/parseRow` is a finding. Import the public file that uses it, or — if the file is genuinely shared — move it out of `internal/`.
- **The path is the whole statement.** Privacy is where the file sits, so a reader sees it in the import line itself, with no list in another file to consult.
- **Nested folders nest the rule.** `src/ingestion/parser/internal/tokenize.ts` is private to `src/ingestion/parser/`.
- **`internal/` marks privacy, not a new kind of place.** What goes inside it follows the same placement rules as any other folder — shared helpers in a `common/` under it, a graduated concept in its own folder.

A repo opts into this rule by naming it in `standards-checks`; until it does, nothing here applies to it.
