---
summary: "a component past its threshold with logic that could be a sub-component"
checked: false
severity: advisory
---

### Components (.tsx)

| Lines   | Assessment                                                         |
| ------- | ------------------------------------------------------------------ |
| <100    | Almost always fine                                                 |
| 100–150 | Review — acceptable if mostly JSX composition with no inline logic |
| 150+    | Likely needs extraction                                            |
| 200+    | Definitely needs extraction                                        |
