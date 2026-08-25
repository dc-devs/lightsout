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

**The one exemption, in one sentence:** a function is exempt when every
statement is a call to a named step (or the assignment of its result) and the
control flow is linear — any inline loop, branch, or transformation
disqualifies it. A 150-line `start()` calling 8 step functions is fine; a
150-line function with an inline loop is not. Such a function has no logic to
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
