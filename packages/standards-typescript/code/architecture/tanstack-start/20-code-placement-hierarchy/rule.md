---
summary: "shared code placed at a level above the scope that uses it"
checked: false
severity: advisory
---

## Code Placement Hierarchy

| Scope              | Location                                                 | When to Use                         |
| ------------------ | -------------------------------------------------------- | ----------------------------------- |
| App-wide           | `src/common/`                                            | Used by 2+ features                 |
| Feature-wide       | `features/{feature}/common/`                             | Used by 2+ screens in one feature   |
| Screen-wide        | `features/{feature}/screens/{screen}/components/common/` | Used by 2+ components in one screen |
| Component-specific | `{component}/common/`                                    | Only used by one component          |
