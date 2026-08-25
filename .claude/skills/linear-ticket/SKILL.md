---
name: linear-ticket
description: How to write and close Linear tickets for the LightsOut team. Use when filing a bug or feature ticket, or when recording what shipped against one.
---

# Writing a LightsOut ticket

A ticket describes **the world**. It does not describe the code you expect to
write. Problems and evidence stay true for months; a predicted solution is
usually wrong within a day, because `/lightsout:brainstorm` and `/lightsout:plan`
exist precisely to kill predictions.

Never put a proposed design in a ticket. If you have a hypothesis, write it as
an open question or leave it out.

## Template

```markdown
As a <actor>,
I want <capability>
so that <value>.

## Problem

<what is wrong — observed, not theorised>

## Evidence

<runs, files, numbers>

## Acceptance Criteria

- Verify that ...
- Verify that ...
```

That is the whole ticket. No "Direction", no "Bar", no "Constraints" section
holding limits you inferred rather than observed.

### Actor

Pick the one whose experience the ticket is about. The role slot must carry
information — if every ticket says the same thing, drop the line rather than
writing ceremony.

| Actor | The ticket is about |
|---|---|
| an agent running a plan | gates, escalations, retries, the pipeline |
| a repo adopting lightsout | config keys, standards packs, defaults |
| a plan author | the grader, brainstorm, plan lint |
| a LightsOut engineer | this codebase itself |

### Evidence

Anchor to names that survive edits — symbols, rule ids, config keys, run ids,
file paths. Avoid line numbers: `checkChangedFilesExecuted.ts:110` is stale the
next time anyone touches the file.

Prefer measured numbers over description. "113 summary entries, 0 ending
`.tsx`" beats "the summary seems to be missing some files".

Quote the failing output verbatim rather than paraphrasing it.

### Acceptance Criteria

Every line starts **"Verify that"**. This is not a style rule — it forces the
criterion to name a check someone can actually run, which is what keeps it
observable.

Write what you could confirm from outside. Never name a structure you expect to
exist:

- Good — `Verify that no check reads raw carve-out fields.`
  Survives any redesign; you can grep for it.
- Bad — `Verify that FrameworkCarveOut exposes typed dimensions.`
  Assumes the answer. When the design changes, the criterion is wrong rather
  than unmet.

Include the criteria that must *keep* holding, not only the new behaviour — a
gate that stops catching real defects has failed even if the reported bug is
gone.

## Closing a ticket

Append one comment. Never rewrite the body: written this way it contains no
prediction, so there is nothing to correct, and the original ask stays legible
beside the outcome.

The comment carries:

- the commit and branch
- a link to the plan that produced it
- what shipped, and where it **diverged** from the ticket — the divergence is
  the valuable part, since it is what the ticket could not have known
- each acceptance criterion, and how it was verified
- anything deliberately left undone, and whether something tracks it

Keep it short. Link the plan rather than restating its decision table.

## Where plans live

`/lightsout:plan` writes `.lightsout/plans/<name>/` — `plan.md`,
`decisions.json`, `grade.json`. That is the design record; the ticket links to
it rather than duplicating it.

Check whether those artifacts are committed before linking. If `.lightsout` is
still fully gitignored, the path resolves only on one machine, and the ticket
needs the decisions summarised in the close comment instead of linked.

## Anti-patterns

Each of these has actually happened on this team.

- **Inventing vocabulary.** A section heading nobody defined ("Bar") spread
  across ~20 tickets because each agent read it in an existing ticket and
  copied it. Use plain words.
- **Inferred constraints.** Writing "anything that requires reading runner
  config breaks that boundary" as a constraint, when it was a guess rather than
  something observed. A future agent then designs around a limit that was never
  real. State only what you checked.
- **Prescribing the fix.** The consuming agent plans the solution. A ticket that
  names the remedy pre-empts the grill that would have found a better one.
- **Detail written early.** A ticket that will sit for weeks should hold less,
  not more — it is written with the least information it will ever have.
