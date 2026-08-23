---
summary: "a function, hook or component over its line cap"
checked: true
severity: advisory
settings:
  function: 80
  hook: 160
  component: 200
---

## Function Size Limits

| Lines | Assessment |
| ----- | ------------------------------------ |
| <=50  | Fine |
| 50-80 | Review — look for extractable logic |
| 80+   | Needs splitting |

Orchestration that only sequences step calls is exempt: a function whose whole
body is "call this, then that, then return what they produced" has no logic to
extract, and splitting it would only scatter the sequence over more files than
the reader has to hold.

Reach for the exemption last, not first. It is the verdict a function earns
once the logic is out of it, not a reason to leave the logic in — and a
function that is genuinely just sequencing calls will be short enough that the
cap never asks. Extract the work into named pieces, then look again: what
remains is either under the cap or visibly a sequence, and either way the
question has answered itself.

Extraction moves cost rather than removing it. Each piece pulled out is a new
name to read and, if it leaves the file, a new file in the folder. Split
because the piece deserves a name, not to buy back lines.

**Exception — orchestration functions** may exceed 50 lines when each step delegates to a dedicated function (no inline business logic) and the flow is linear: a 150-line `start()` calling 8 step functions is fine; a 150-line function with inline loops and transformations is not.
