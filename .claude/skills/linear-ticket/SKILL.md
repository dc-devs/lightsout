---
name: linear-ticket
description: How to write and close Linear tickets for the LightsOut team. Use when filing a bug or feature ticket, or when recording what shipped against one.
---

# Writing a LightsOut ticket

A ticket says what is wrong. It does not say how to fix it.

Write down what you saw: the problem, and the facts that show it. Those stay
true for months. A fix you guess at now is usually wrong within a day.

`/lightsout:brainstorm` and `/lightsout:plan` exist so that the user and an
agent work the fix out together, when someone actually picks the ticket up.
Planning is not the ticket's job.

If you have a hunch about the fix, leave it out or write it as an open
question.

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

## Open questions        <- optional

- <a question the planning session has to settle>
```

Those parts are the whole ticket. If an existing ticket carries extra sections,
do not copy them forward — match this template, not its neighbours.

`## Open questions` is the one place a hunch about the fix is allowed to live,
and only in question form. "Should the ceiling apply per phase?" is a question.
"Apply the ceiling per phase" is a prescription with a question mark bolted on.
Leave the section out when you have none.

### Actor

Pick the actor whose experience the ticket is about. If the line would read
the same on every ticket, it is telling the reader nothing — drop it.

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

Every line starts **"Verify that"**. Those two words force you to name a check
someone can actually run. If you cannot finish the sentence with something
checkable, you do not yet know what you are asking for.

Write only what someone could check from the outside. Do not name a file, type
or function you expect the fix to create:

- Good — `Verify that no check reads raw carve-out fields.`
  Survives any redesign; you can grep for it.
- Bad — `Verify that FrameworkCarveOut exposes typed dimensions.`
  Assumes the answer. When the design changes, the criterion is wrong rather
  than unmet.

Include the criteria that must *keep* holding, not just the new behaviour. If
a gate stops catching real defects, the work failed even when the reported bug
is gone.

### Feature tickets

The template holds for a feature, but three parts carry different weight.

**Problem** is what is absent, or what is worse without the thing. If you cannot
state that, the ticket is not ready — a feature with no problem behind it is
usually a preference looking for a justification.

**Evidence** is not proof of a defect, because there isn't one. It is what is
already true about the world the feature has to fit into: what a tool it depends
on can and cannot do, what the current code already provides, what you measured,
and what you checked but could not confirm. Same discipline as a bug's evidence
— anchored to names, measured where you can, no proposed design. Different
content.

If you have nothing, say so in the section rather than dropping it. "Filed from
a hunch, no runs behind it" tells the next reader how much weight to give it.

**The value clause carries more here.** On a bug it is close to ceremony — the
value of not being broken is obvious. On a feature it is the only place the
reason lives, and a feature's reason is genuinely arguable. Spend the effort
there.

**Acceptance criteria are easier to get wrong.** On a bug they are anchored: the
wrong thing stops happening, the right things keep working. On a feature they
are the closest thing to a spec, with no bug report holding you to observable
behaviour, so a design decision can slip in wearing a checkbox:

- Good — `Verify that a repo configured for the Pi harness completes a full run.`
- Bad — `Verify that createPiDriver parses agent_end.`
  Names a file and a mechanism nobody has chosen yet.

## Keeping the body true

The body holds facts, so keep the facts current. When planning turns up a
sharper problem statement, better evidence, or an acceptance criterion that was
wrong, **edit the body to say the new thing**.

Write the new version as plain fact. "The summary holds 113 entries, none
ending `.tsx`" — not "we originally thought X, but it turned out to be Y".
Nobody reading later needs the wrong version, and Linear keeps the edit history
if anyone does.

Editing is safe here only because the body never held a proposed fix. There is
nothing in it you can be caught out by, so every edit just makes the ticket
more accurate.

## Closing a ticket

Append one comment, and keep it short:

- what shipped
- the PR (which carries the branch and the commits)
- each acceptance criterion, and how it was verified
- anything deliberately left undone, and whether another ticket tracks it

Attach the plan (see below). It holds the reasoning and the rejected options;
do not restate its decision table in the comment.

Write down results, not the story of getting there. Leave out what you tried,
what you gave up on, and how the finished work compared to the original ticket.
If the ticket itself turned out to be wrong, fix the body — see above.

## Attaching the plan

`/lightsout:plan` writes `.lightsout/plans/<name>/` — `plan.md`,
`decisions.json`, `grade.json`. That is the design record: what was decided,
what was rejected, and why.

Those files live on one machine. `.lightsout` is gitignored, so the path is not
a link — it resolves for nobody but the author, and not for the author on a
different laptop. Never paste a filesystem path into a ticket and call it a
reference.

**Attach these three when you close the ticket:**

| file | what it holds |
|---|---|
| `plan.md` (or `overview.md`) | the plan that was built |
| `decisions.json` | every question asked, the option chosen, and why — including which choices were assumptions nobody confirmed |
| `grade.json` | half a kilobyte recording that the plan was graded, and against which lenses |

Skip `facts.json` — it predicts which files the work will touch, and once the
PR exists the diff answers that better. Skip `dedup.json` and every
`*-stream.jsonl`; the streams are the raw brainstorm transcripts, roughly 98% of
the folder by size, and `decisions.json` already holds their conclusions.

Attach at close, never when you file. Until the run finishes the plan can still
change, and a copy of a changing document goes stale exactly the way a
guessed-at fix does.

Do not paste the plan into the ticket body, and do not put it in a Linear
Document. A document invites editing, and then two copies disagree about what
was decided. An attached file cannot drift.

## Anti-patterns

Each of these has actually happened on this team.

- **Inventing vocabulary.** A one-word section heading nobody had defined
  spread across ~20 tickets, because each agent read it in a neighbouring
  ticket and copied it. Nobody could say what belonged under it. Use plain
  words, and prefer no section to a section you cannot define.
- **Inferred constraints.** Writing "anything that requires reading runner
  config breaks that boundary" as a constraint, when it was a guess rather than
  something observed. A future agent then designs around a limit that was never
  real. State only what you checked.
- **Prescribing the fix.** The consuming agent plans the solution. A ticket that
  names the remedy pre-empts the grill that would have found a better one.
- **Detail written early.** A ticket that will sit for weeks should hold less,
  not more. On the day you file it you know less about the problem than anyone
  who reads it later.
