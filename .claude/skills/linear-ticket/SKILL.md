---
name: linear-ticket
description: How to write, update and close Linear tickets for the LightsOut team, and how a branch is named after one. Use when filing a bug or feature ticket, starting work on one, or recording what shipped.
---

# LightsOut tickets

This describes what a ticket looks like — its shape, and what belongs in it.
It does not run the work. The pipeline does that.

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

#### On a `route-direct` ticket, the criteria carry the decisions

A `route-direct` ticket has no brainstorm and no plan behind it, so the body is the
only place a decision already made with the user can live. Write each one as a
criterion, because a decision is an outcome: "the landing page shows no
repository sidebar" is a thing you can check, and it stays checkable however
the layout is built.

That is the test for the label. **If a decision cannot be written as something
checkable, the ticket is not `route-direct`** — what you are holding is a design, and
a design goes to `/lightsout:brainstorm` to be made against the code as it is
on the day someone builds it.

Write the decision, never the mechanism a decision implies:

- Good — `Verify that a link into the repository pages appears only when a
  repository is found.`
- Bad — `Verify that TopNav renders an App link from repoRootQueryOptions.`
  Names the two components that happen to exist today.

The rest of the rules do not bend for this. No section is added, nothing is
attached, and a decision nobody made stays out — the criteria on a `route-direct`
ticket are still only what the user settled and what you checked.

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

## Route

Every ticket takes one of three routes to being built. The route is a
**judgment**, made by whoever writes the ticket or picks it up, and written
down. Never derive it from a proxy — not the file count, not whether the ticket
has open questions, not how long the body is. A ticket with nothing unsettled
can still be forty files that need sequencing before anyone types, and a
twenty-line change can turn on a decision you will live with for a year.

| Label | Means | Produces |
|---|---|---|
| `route-brainstorm` | Run `/lightsout:brainstorm`, then decide whether it also needs a plan. **This is the default.** | Notes and settled decisions, and usually a plan after it |
| `route-plan` | Go straight to `/lightsout:plan`. | A plan folder |
| `route-direct` | Build it. No brainstorm, no plan. | The diff, and nothing else |

The three sit in a Linear label group called `Route`, so a ticket carries
exactly one. Each name repeats the prefix anyway, and that redundancy is
deliberate: Linear's issue sidebar shows the bare label without its group, so a
label named `brainstorm` alone would read as an instruction to go and brainstorm
— which is wrong the moment the brainstorm is done and the ticket is waiting to
be built. `route-brainstorm` reads as a classification whenever you meet it.

**Brainstorm is the default whenever there is design work.** It is where a vague
idea gets shaped, where competing approaches get weighed, and where the thing
turns out to be three tickets instead of one. Reaching for a plan first skips
all of that and plans the wrong thing carefully.

**`route-plan` is the exception, not a peer.** It applies only when a brainstorm
has already settled **this ticket's own** design — usually the brainstorm that
produced the ticket. A brainstorm about a neighbouring ticket does not count,
however much context it shares: the tickets that fall out of one brainstorm are
its by-products, not its subjects, and nobody has yet shaped them.

**`route-direct` is for work with no design in it.** The change is local, the diff is
describable in a sentence, and being wrong is cheap to undo. It is a real route
and using it is not cutting a corner — but it is a claim, and the claim gets
recorded with the label.

A ticket carrying none of the three is **undecided**, which is a legitimate
state. Most of a backlog sits there. Do not force a route at filing time to
avoid an empty field.

### The route is not the status

The route says how a ticket gets shaped. The **status** says where it is. They
answer different questions and neither substitutes for the other.

A ticket whose shaping is finished — the brainstorm ran, the plan is written and
graded — is not waiting on a route. It is waiting on someone to build it, and it
belongs in **Ready to implement**. Its label stays as the record of how it got
there; reading it as an instruction to go and brainstorm again is a misreading,
and leaving such a ticket in Backlog hides finished work behind unstarted work.

The statuses follow the pipeline, and the names are the pipeline's own:

```
Backlog → Ready to implement → In Progress → Done
```

Move a ticket to **Ready to implement** the moment its route is complete:

| Route | Complete when |
|---|---|
| `route-direct` | Immediately — there is nothing to shape |
| `route-brainstorm` | The brainstorm ended, and the plan it called for (if any) is graded |
| `route-plan` | The plan is graded |

"Ready to implement" means exactly what it says: `/implement` can be pointed at
it now. For a routed-and-planned ticket that means the plan folder exists and
graded; for a `route-direct` one it means the ticket body is enough to build from.

### Recording it

**The label is the record.** It is a real field on the ticket: filterable, and
it overwrites rather than accumulating. Do not restate it in a comment. Each of
the three carries its own description in Linear, and they are defined above —
`route-brainstorm` already says why it is `route-brainstorm`, and a sentence per
ticket repeating that is ceremony that rots.

**Whoever picks the ticket up may change it**, by changing the label and
nothing else. The filer knows less about the problem than anyone who reads it
later — that holds for the route as much as for the facts. Do not leave a
comment explaining the change: the route is current state, and the same rule
applies as to the body. Nobody reading later needs the wrong version, and Linear
keeps the revision history for anyone who does.

**`route-plan` is the one route that owes evidence**, because it is the only one
asserting a fact: that a brainstorm already settled this ticket's design.
Without proof anyone can claim it and skip the step, which is the one failure
mode that would quietly undo this whole section.

So: **attach the brainstorm's `notes.md` when you set `route-plan`.** Not at
close — now. That file is safe to attach early in a way a plan is not: brainstorm
writes it once, and `/lightsout:plan` snapshots it write-once and never
overwrites, so it is frozen the moment the brainstorm ends. `.lightsout` is
gitignored, so it exists on exactly one laptop; attach it or it is gone.

Attach `notes.md` alone. `brainstorm-decisions.json` is machine input — `plan
draft` merges those rows into the plan, so `plan.md`'s Decision Log carries all
of them by the time you close, and attaching it would put the same rows in the
ticket twice.

Two cases that therefore do **not** qualify for `route-plan`, and this is the
useful part of the rule rather than a technicality:

- A brainstorm that exited at "just build it" wrote no files. Nothing to attach.
  That ticket is `route-direct`, or it is already done.
- A design settled in conversation with nothing written down. Nothing to attach.
  If you want to skip the brainstorm step, the brainstorm has to have left
  something behind.

**At close, state the route actually taken**, not the one the label predicted. A
`route-direct` ticket that turned out to need a plan is the more useful fact: it is
how you learn where the judgment runs thin. This is the one place the route's
history is worth writing down, because it is an outcome rather than a running
log, and it is written once at the point the ticket stops changing.

### Do not invent a lighter plan

There is no small-plan format for `route-direct` work. The moment one exists every
ticket gets one, and the ceremony the route exists to avoid grows back. The
closing comment is the record.

This is not the same as losing what was already decided. A decision settled with
the user before the ticket was filed belongs in the acceptance criteria, written
as an outcome — see [On a `route-direct` ticket, the criteria carry the
decisions](#on-a-direct-ticket-the-criteria-carry-the-decisions). That needs no
new section and no attachment, which is why it does not grow into one.

## Branch

A branch is named after its ticket: `lo-<number>-<slug>` —
`lo-45-web-app-design`.

The branch is the same whichever route the ticket took. It is the one thing that
links the ticket, the worktree, the commits and the PR, so it never varies.

Linear finds the ticket id anywhere in the name and links the branch to the
issue. Its copy-branch-name button prefixes your username; drop that, the id
is the only part that matters.

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
- the route taken (see above), and for `route-direct`, one line on why there was no
  plan — a closed ticket with nothing attached is otherwise ambiguous between
  "small enough not to need one" and "process skipped", and six months on
  nobody can tell which
- each acceptance criterion, and how it was verified
- anything deliberately left undone, and whether another ticket tracks it

Attach the plan (see below) when the route produced one. It holds the reasoning
and the rejected options; do not restate its decision table in the comment.

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

A `route-direct` ticket has no plan folder and nothing to attach. That is expected —
say so in the closing comment rather than leaving a silent gap.

A `route-brainstorm` ticket that stopped at "just build it" has notes but no
plan. Attach nothing; the closing comment carries what was decided.

**Attach these four when the route produced a plan:**

| file | what it holds |
|---|---|
| `notes.md` | the brainstorm: the idea in the user's words, the scope call, the approach chosen and the ones rejected |
| `plan.md` (or `overview.md`) | the plan that was built |
| `decisions.json` | every question asked, the option chosen, and why — including which choices were assumptions nobody confirmed |
| `grade.json` | half a kilobyte recording that the plan was graded, and against which lenses |

Skip `facts.json` — it predicts which files the work will touch, and once the
PR exists the diff answers that better. Skip `brainstorm-decisions.json`: `plan
draft` merges its rows into the plan, so `plan.md`'s Decision Log already
carries every one of them.

Skip `dedup.json`, every `*-stream.jsonl` and every `*-rejected-*.txt`. The
streams are the harness event log for each `draft`, `dedup` and `grade` agent —
not brainstorm, which runs no engine command and writes no stream — and they are
roughly 98% of the folder by size. One sampled stream ran 215 lines and 240 KB,
of which 138 lines were token-accounting events. Their conclusions are already in
`grade.json` and `plan.md`; what is unique to them is which files an agent opened
and what it thought, which is a debugging artifact, not something a person
picking up a ticket reads. Keep them on disk — the rejected payloads in
particular are the record of how an agent's report failed its contract — and
attach neither.

### Attach when the ticket is ready to implement, not at close

The moment a route completes and the ticket moves to **Ready to implement**,
attach the files. Waiting until close assumes whoever builds it is whoever
planned it, on the machine that planned it — the assumption this whole system
exists to break.

`.lightsout` is gitignored. Until these files are attached, a plan exists on
exactly one laptop, and any other agent picking up that ticket sees a problem
statement with none of the shaping behind it.

Attaching them makes the ticket **readable** by a fresh agent. It does not yet
make it **runnable**: `/lightsout:implement` takes a folder path on disk, so the
agent must rebuild `.lightsout/plans/<name>/` from the attachments before the
command works. It can derive the folder name from the ticket id when the plan
was named after its ticket.

Re-attach at close if implementing amended the plan. The final version is the
one worth keeping, and Linear shows both.

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
