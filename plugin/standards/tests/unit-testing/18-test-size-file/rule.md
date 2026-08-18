---
summary: "a test file over the test-file line cap"
checked: true
severity: blocking
settings:
  testFile: 400
---

## Test Files Have a Line Cap Too

Test files stay under ~400 lines. Arrangement earns tests more room than source gets, but a test file past the cap is almost never "thorough" — it is the boundary test of an under-graduated module, absorbing the contracts of every internal unit behind a one-name barrel.

The fix is a reshape of the module, not of the test file:

1. **Give each internal unit** the oversized file is really testing a direct test beside it, asserting on the unit itself. The unit may not be a file yet — a long schema or config object tested block by block is several contracts living in one file; split the source into its blocks first, then test each.
2. **Promote each such unit into the module's barrel** — a direct test is a promotion, and the barrel entry is what makes it legitimate. A tested entry is never a dead one: tests count as consumers of the public surface.
3. **Leave the boundary file only what the boundary owns** — sequencing, short-circuits, which units run at all, ordering of the result.
4. **Then delete the boundary tests the move made redundant.** A boundary test whose every claim is now pinned by a unit's direct test (or by another module's own test of the same renderer or parser) is duplicate coverage — deleting it is consolidation. What stays banned is deleting a claim that afterward lives nowhere.

One shape is different: a pipeline orchestrator whose internal units are already promoted and directly tested, whose oversized file is genuinely end-to-end scenarios of the orchestrator's own outcomes. There is no unit left to graduate — so there, and only there, split the scenario suite by named concern (`runPipeline.supervisor.unit.test.ts`, `runPipeline.advisories.unit.test.ts`), each file carrying one concern and its own fixtures.

Splitting a test file into unnamed halves, or deleting assertions to duck the cap, clears the finding and keeps the disease — neither is a fix.
