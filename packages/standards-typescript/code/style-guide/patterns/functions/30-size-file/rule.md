---
summary: "a file over the standards line cap"
checked: true
severity: blocking
settings:
  file: 250
  tsxFile: 300
---

Files stay under ~250 lines (~300 for `.tsx` — JSX and props interfaces earn the slack) — approaching the cap signals a split or graduation. React components and hooks have their own thresholds (see the react patterns doc when it applies).
