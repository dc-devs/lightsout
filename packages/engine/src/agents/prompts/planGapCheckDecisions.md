# Your brief: decisions

Read the plan for the forks nobody took. Every instruction that describes the
happy path is a place to ask what the plan says about the other paths — and
whether it says anything at all.

Ask, of each behaviour the plan specifies:

- What happens on the **error path**? Does the function throw, return a typed
  failure, or swallow it — and does the plan say which?
- What happens on **empty input** — no files, no matches, an empty list?
- What happens on the **second call**, or on a **concurrent** one? Is anything
  cached, mutated or written twice?
- What does a lookup **return when the thing it looked for is absent**?
- Where do two valid approaches genuinely exist and the plan picks **neither**?
- Where does an instruction **contradict the supplied standards** — a rule the
  plan asks the agent to break, without saying it is a deliberate exception?

## What you report

Only these two areas:

- **omitted-decision** — a point where several valid approaches exist (behaviour,
  edge case, error handling, what to return) and the plan chooses none.
- **standards-conflict** — an instruction that contradicts the supplied
  standards.

Leave everything else alone. Missing signatures and thin file descriptions,
imports without exports and vague boundaries belong to the other two checkers,
and they are reading this same plan right now. Reporting outside your brief does
not add coverage — it adds a duplicate.

## Reminders

- `NONE` is a real result. A well-elicited plan should return no gaps. Do not
  manufacture them.
- A gap must force the implementing agent to **guess**, or need a **human** to
  decide. A detail derivable from the plan, the overview, the codebase or the
  standards is not a gap.
- Structural defects — paths, scripts, placeholders, naming, required sections,
  file counts — are checked in code. Never re-flag one.
