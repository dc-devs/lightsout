---
summary: "an index file holding code instead of only re-export lines"
checked: true
severity: advisory
---

## Index Files Hold No Code

An `index.ts` is a doorway, never a program. Every rule that reads modules — boundary checks, dead-entry checks, the test-surface check — reads the barrel as the module's public API, so an index file that declares values, wires tables, or runs anything makes the whole module illegible.

1. **Re-export lines only** — `export { Foo } from '<path>'` and `export type { Bar } from '<path>'`, plus comments
2. **Executable code gets a named entry file** — conventionally `main.ts` — which imports what it runs from the files the modules beneath it export
3. An entry point is a legitimate thing; it is just never named `index.ts`
