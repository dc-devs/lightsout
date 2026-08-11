---
summary: "a `common/` folder sitting at a level that does not match the modules reaching it"
checked: false
severity: advisory
---

## Example

```
src/
├─ common/            # shared across ALL modules
│  ├─ utils/          #   (formatDate.ts — no barrels under common/)
│  ├─ types/
│  ├─ services/
│  ├─ formatting/     # domain folder: 2+ related pure functions
├─ featureA/
│  ├─ common/         # shared within featureA only
│  │  ├─ utils/
│  │  ├─ types/
│  ├─ featureA.ts
│  └─ index.ts
```

Reading the hierarchy: `src/common/` serves every feature; `src/featureA/common/` serves only `featureA`. If a helper there is later needed by `featureB`, promote it to `src/common/utils/`.
