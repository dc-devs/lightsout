---
summary: "a function, hook or component over its line cap"
checked: true
severity: advisory
settings:
  function: 80
  hook: 160
  component: 200
---

## Function Size Limits

| Lines | Assessment |
| ----- | ------------------------------------ |
| <=50  | Fine |
| 50-80 | Review — look for extractable logic |
| 80+   | Needs splitting |
