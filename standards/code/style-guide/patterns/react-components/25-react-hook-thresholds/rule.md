---
summary: "a hook that computes rather than composes, past its threshold"
checked: false
severity: advisory
---

### Hooks (.ts)

| Lines  | Assessment                               |
| ------ | ---------------------------------------- |
| <80    | Fine                                     |
| 80–120 | Review — look for extractable pure logic |
| 120+   | Likely needs utility extraction          |
| 160+   | Definitely needs extraction              |

Pure logic inside hooks should be extracted to utility functions. The hook itself should compose, not compute.
