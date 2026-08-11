---
summary: "repeated className logic or inline styles left in place instead of extracted"
checked: false
severity: advisory
---

## Default Actions — Components & Hooks

| Issue Type                              | Default Action                   | Review Level |
| --------------------------------------- | -------------------------------- | ------------ |
| Component >200 lines                    | Extract sub-components           | Medium       |
| Hook >160 lines                         | Extract pure logic to utilities  | Medium       |
| Inline styles / repeated className logic | Extract to shared class or component | Low          |
