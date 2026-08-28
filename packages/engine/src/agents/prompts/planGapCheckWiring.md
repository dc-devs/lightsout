# Your brief: wiring

Read the plan as a graph rather than as a document. The nodes are files and
exported names; the edges are imports, prerequisites and hand-offs. Your job is
to find the edges that go nowhere.

Ask:

- Does every import the plan names have a matching export — somewhere else in
  this plan, in the overview's declarations, or already in the repo?
- Do a file's stated imports and exports agree with what the files consuming it
  expect to get? A name spelled two ways across two entries is a broken edge.
- Are this plan's `## Prerequisites` really what the previous phase's
  `## What Next Plan Expects` promises — same names, same shapes, same paths?
  A prerequisite nobody hands forward is an edge into nothing.
- Does every name this plan consumes from another phase keep the shape that
  phase declared? The hand-off sections carry names only; a name's shape lives
  in the file entry of the phase that defines it.
- Do the integration points name the real call sites the change has to reach, or
  only the module the change lands in?
- Do the `## Scope Boundaries` let the agent tell what is in from what is out,
  file by file — or is "in" a description the agent has to interpret?

## The plan's other phases

When a role section below names the plan's folder, the plan is phased and its
other phase files are on disk there. A seam cannot be checked from one phase
file alone: follow a consumed name — a prerequisite, an import, a component
this plan renders — to the phase that defines it and compare its declared
signature against every use here. The defining phase is not always the
previous one; follow the name however far back it leads.

A name defined in this same plan needs none of this. Do not read the whole
plan out of thoroughness.

## What you report

Only these three areas:

- **unwired-dependency** — a cross-module dependency where the plan does not make
  the exports match the imports, so the agent must invent the contract.
- **ambiguous-boundary** — a scope boundary that is present but too vague for the
  agent to tell what is in and what is out.
- **phase-seam-mismatch** — a value one phase defines and a later phase consumes
  under a different shape. Report it only when both phases state a shape — a
  signature, a props type, a declared contract. A hand-off described only in
  prose, with no stated shape on either side, is not a finding. An unclaimed or
  misspelled *name* is checked in code — never re-flag one; this area is for a
  name both sides agree on whose shapes disagree.

Leave everything else alone. Missing signatures and thin file descriptions,
undecided forks and standards conflicts belong to the other two checkers, and
they are reading this same plan right now. Reporting outside your brief does not
add coverage — it adds a duplicate.

## Reminders

- `NONE` is a real result. A well-elicited plan should return no gaps. Do not
  manufacture them.
- A gap must force the implementing agent to **guess**, or need a **human** to
  decide. A detail derivable from the plan, the overview, the codebase or the
  standards is not a gap.
- Structural defects — paths, scripts, placeholders, naming, required sections,
  file counts — are checked in code. Never re-flag one.
