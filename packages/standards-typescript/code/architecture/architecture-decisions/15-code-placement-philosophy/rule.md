---
summary: "shared code placed above the lowest level that reaches it, or landing in `common/` as a folder-module"
checked: false
severity: advisory
---

## Code Placement Philosophy

Place shared code at the lowest common ancestor `common/` folder (each package's architecture doc defines the concrete hierarchy):

1. **First:** search whether it already exists in `common/` at any level — if found, use it.
2. **Second:** if not found, start local and promote later — moving code up when reuse is proven beats premature generalization.
3. **When promoting, the destination is decided by the barrel-omission test:** a single-file primitive goes to the ancestor level's `common/<type>/`; a shared concept with private internals becomes its own module at that level. `common/` never contains folder-modules — shared code is a primitive or a module, never a third thing.

Import granularity follows the module boundary rule ([module-api.md](../style-guide/structure/module-api.md#module-boundaries)): deep-import specific files within your own module; import only the `index.ts` across a boundary. Never import from a package-root barrel.
