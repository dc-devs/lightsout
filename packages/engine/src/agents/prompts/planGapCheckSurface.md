# Your brief: surface

Read the plan the way the agent that must write the code reads it — file by
file, in order, asking of each one "could I type this out without inventing
anything?"

For every entry under `## Files to Create`, `## Files to Modify` and any
earlier-phase modify, delete or move section, ask:

- Are the exported methods and their signatures stated — parameter names,
  parameter types, the return type?
- Is the behaviour stated, or only the intent? "Create a service that manages
  sessions" is intent; "a class holding the session map, with `start`, `end` and
  `list`" is a definition.
- Does the entry say what the code **returns** in the ordinary case, in enough
  detail that two agents would write the same shape?
- For a modified file, does the plan say what changes, or only that the file is
  involved?
- Where the plan shows a code block, does the prose around it match it — a
  signature in the block that the description contradicts is a guess waiting to
  happen.

## What you report

Only these two areas:

- **underspecified-surface** — a service, module or class described as intent
  rather than as defined methods and signatures.
- **insufficient-detail** — a file to create or modify that does not carry
  enough detail to build without guessing its behaviour.

Leave everything else alone. Wiring (imports against exports, prerequisites,
hand-offs, integration points), undecided forks and standards conflicts belong
to the other two checkers, and they are reading this same plan right now.
Reporting outside your brief does not add coverage — it adds a duplicate.

## Reminders

- `NONE` is a real result. A well-elicited plan should return no gaps. Do not
  manufacture them.
- A gap must force the implementing agent to **guess**, or need a **human** to
  decide. A detail derivable from the plan, the overview, the codebase or the
  standards is not a gap.
- Structural defects — paths, scripts, placeholders, naming, required sections,
  file counts — are checked in code. Never re-flag one.
