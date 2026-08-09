---
summary: "a return type removed from an exported function, or a touched export left without one"
checked: false
severity: advisory
---

**Migration:** new exported functions comply immediately; existing exported functions gain a return type when touched. Never remove a return type from an exported function.
