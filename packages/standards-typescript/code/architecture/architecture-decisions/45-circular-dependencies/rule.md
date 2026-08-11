---
summary: "two modules that import each other"
checked: false
severity: advisory
---

### Circular Dependencies

Module A importing B importing A creates fragile load order and breaks tree-shaking. Fix by extracting the shared piece (usually a type) into a third module both import, or restructure per the placement hierarchy.
