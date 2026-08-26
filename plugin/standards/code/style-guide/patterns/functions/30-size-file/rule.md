---
summary: "a file over the standards line cap"
checked: true
severity: advisory
settings:
  file: 250
  tsxFile: 300
---

Files stay under ~250 lines (~300 for `.tsx` — JSX and props interfaces earn the slack) — approaching the cap signals a split or graduation. React components and hooks have their own thresholds (see the react patterns doc when it applies).

The cap exempts a barrel in any source dialect — `index.tsx` included — because a module's public API cannot take the remedy a size finding asks for.
