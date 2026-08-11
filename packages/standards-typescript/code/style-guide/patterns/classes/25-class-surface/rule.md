---
summary: "a method added to a class for logic that never touches the class's state"
checked: false
severity: advisory
---

## Keep the Class Surface Small

Prefer extracting logic into functions over adding instance methods: before graduation, non-exported helpers in the class file; after, files under the folder's `common/utils/`. The class surface stays limited to behavior that genuinely needs its state; logic is covered through the class's public API.
