---
name: ticket-workflow
description: How to write, update and close a ticket, and how a branch and pull request are named after one. Use when filing a bug or feature ticket, choosing how it gets shaped, starting work on one, opening its pull request, or recording what shipped.
---

# Ticket workflow

This describes what a ticket looks like — its shape, and what belongs in it.
It does not run the work. The pipeline does that.

A ticket says what is wrong. It does not say how to fix it.

Write down what you saw: the problem, and the facts that show it. Those stay
true for months. A fix you guess at now is usually wrong within a day.

The `brainstorm` and `plan` skills exist so that the user and an
agent work the fix out together, when someone actually picks the ticket up.
Planning is not the ticket's job.

If you have a hunch about the fix, leave it out or write it as an open
question.

**An agent never files a ticket the user has not approved.** Approval means
the user said yes to *this specific ticket*, in the moment — after seeing
what it will say. "We'll do that later", "yes, but later", or any other
deferral is a candidate, not approval: ask "want a ticket for X?" and file
only on yes. A "no" is written down nowhere new — declined means declined.

## One home per fact

Every fact lives in exactly one place, and everything else points at it:

| Fact | Its one home |
|---|---|
| The problem, the evidence, the checks | the ticket body |
| Decisions settled before shaping | the ticket's `## Decisions` |
| Decisions made during shaping | the plan artifacts, attached |
| How the ticket gets shaped | the route label |
| The change itself | the PR diff |

Data flows forward only — ticket → plan files → attachments — never back
into the body. A second copy of any of these drifts, and an agent reading
the drifted copy makes wrong calls: it re-asks settled questions, reads a
check as a scope ruling, or files a ticket for an idea already rejected.

## Template

```markdown
## Problem

<what is wrong — observed, not theorised. Close with one sentence on
why it matters: who is hurt, what it costs.>

## Evidence

<runs, files, numbers>

## Acceptance Criteria

- Verify that ...
- Verify that ...

## Decisions             <- optional

- <an outcome the user explicitly settled>

## Open questions        <- optional

- <a question the shaping has to settle>
```

Those parts are the whole ticket. If an existing ticket carries extra
sections, do not copy them forward — match this template, not its neighbours.

There is no user-story preamble. The one part of it that earned its keep —
why the thing matters — survives as the sentence that closes Problem.

### Problem

What is wrong, observed rather than theorised. For a feature: what is
absent, or what is worse without it. If you cannot state that, the ticket
is not ready — a feature with no problem behind it is usually a preference
looking for a justification.

The closing why-sentence names who is hurt — an agent running a plan, a
repo adopting lightsout, a plan author, an engineer on this codebase — and
what it costs. On a bug it is one line; the value of not being broken is
obvious. On a feature it is the only place the reason lives, and a feature's
reason is genuinely arguable — spend the effort there. If the sentence would
read the same on every ticket, it is telling the reader nothing; sharpen it.

### Evidence

Anchor to names that survive edits — symbols, rule ids, config keys, run ids,
file paths. Avoid line numbers: `checkChangedFilesExecuted.ts:110` is stale the
next time anyone touches the file.

Prefer measured numbers over description. "113 summary entries, 0 ending
`.tsx`" beats "the summary seems to be missing some files".

Quote the failing output verbatim rather than paraphrasing it.

On a feature there is no defect to prove. Evidence is what is already true
about the world the feature has to fit into: what a tool it depends on can
and cannot do, what the current code already provides, what you measured,
and what you checked but could not confirm. Same discipline, different
content. If you have nothing, say so in the section rather than dropping
it — "filed from a hunch, no runs behind it" tells the next reader how much
weight to give it.

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

**Criteria are floors, never ceilings.** A criterion records the observed
case, not the boundary of the fix. That a criterion names only one step
means the defect was seen there — it does not decide that the other steps
are out of scope. Silence in a criterion decides nothing; scope narrows
only in `## Decisions`. A check and a decision never share a line.

On a feature, criteria are the closest thing to a spec, with no bug report
holding you to observable behaviour, so a design decision can slip in
wearing a checkbox:

- Good — `Verify that a repo configured for the Pi harness completes a full run.`
- Bad — `Verify that createPiDriver parses agent_end.`
  Names a file and a mechanism nobody has chosen yet.

### Decisions

One line per outcome the user **explicitly settled**, written as the
outcome — "the landing page shows no repository sidebar" — never as the
mechanism it implies.

- **Agents treat these lines as final.** Brainstorm and plan harvest them
  as settled rows and never re-ask them. A settled line re-opens only on a
  contradiction named at a specific `file:line`.
- **Only what the user actually said belongs here.** A hunch, however
  strong, goes to `## Open questions`. This section must never become the
  place a proposed fix hides.
- **Pre-shaping decisions only.** Once a brainstorm or plan runs, new
  decisions land in its files and reach the ticket as attachments. Nothing
  is copied back into the body.
- On a `route-direct` ticket this is the only decision record, and that is
  the point: the route with no plan still has a home for what was agreed.

### Open questions

A queue, not a record. Shaping drains it:

- Brainstorm and plan take these lines as their agenda.
- **"No" is an answer.** "We will not do X" is recorded as a decision row
  in the plan artifacts like any other. A rejected idea never becomes a
  ticket — and even "yes, but later" is only a candidate: a ticket exists
  only when the user approves that ticket (see above).
- When the ticket goes **Ready to implement**, delete every answered line.
  It is the same edit that puts the attachments on: the answers arrive on
  the ticket in the same action the questions leave it.
- At close the section is empty or gone. A closed ticket that still has
  open questions is the sign a step was skipped.

Leave the section out when you have none. It is the one place a hunch about
the fix is allowed to live, and only in question form. "Should the ceiling
apply per phase?" is a question. "Apply the ceiling per phase" is a
prescription with a question mark bolted on.

## Route

Every ticket takes one of four routes to being built. The route is a
**judgment**, made by whoever writes the ticket or picks it up, and written
down. Never derive it from a proxy — not the file count, not whether the ticket
has open questions, not how long the body is. A ticket with nothing unsettled
can still be forty files that need sequencing before anyone types, and a
twenty-line change can turn on a decision you will live with for a year.

| Label | Means | Produces |
|---|---|---|
| `route-brainstorm` | Run the `brainstorm` skill, then decide whether it also needs a plan. **This is the default.** | Notes and settled decisions, and usually a plan after it |
| `route-plan` | Go straight to the `plan` skill. | A plan folder |
| `route-auto-plan` | Run the `auto-plan` skill. It plans the ticket alone and stops at one proposal. | A plan folder, and a proposal to approve |
| `route-direct` | Build it. No brainstorm, no plan. | The diff, and nothing else |

The four routes are recorded as a single-valued field on the ticket, and every
name carries the `route-` prefix so it reads as a classification wherever it
appears rather than as an instruction.

**Brainstorm is the default whenever there is design work.** It is where a vague
idea gets shaped, where competing approaches get weighed, and where the thing
turns out to be three tickets instead of one. Reaching for a plan first skips
all of that and plans the wrong thing carefully.

**`route-plan` is the exception, not a peer.** It applies only when a brainstorm
has already settled **this ticket's own** design — usually the brainstorm that
produced the ticket. A brainstorm about a neighbouring ticket does not count,
however much context it shares: the tickets that fall out of one brainstorm are
its by-products, not its subjects, and nobody has yet shaped them.

**`route-direct` is for work with no design left in it.** The change is local,
the diff is describable in a sentence, and being wrong is cheap to undo. What
was agreed with the user lives in `## Decisions`; the criteria stay checks. It
is a real route and using it is not cutting a corner — but it is a claim, and
the claim gets recorded with the label.

**`route-auto-plan` is for a ticket whose shape is settled but whose build is
not trivial.** There is design work left, but it is the kind you would answer
with "you decide" — the skill answers it and shows you what it chose. It owes
no evidence the way `route-plan` does, because it asserts nothing about a
brainstorm having happened; what it asserts is a judgment about how much of the
interview would be delegated, and being wrong costs one veto at the proposal
rather than a wasted plan.

A ticket carrying none of the four is **undecided**, which is a legitimate
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

A ticket moves through backlog, ready-to-implement, in-progress and done
states, whatever the tracker calls them — the tracker add-on names them.

Move a ticket to **Ready to implement** the moment its route is complete:

| Route | Complete when |
|---|---|
| `route-direct` | Immediately — there is nothing to shape |
| `route-brainstorm` | The brainstorm ended, and the plan it called for (if any) is graded |
| `route-plan` | The plan is graded |
| `route-auto-plan` | The plan is graded and its proposal approved |

"Ready to implement" means exactly what it says: the `implement` skill can be
pointed at it now. For a routed-and-planned ticket that means the plan is graded
and its durable files have been published to the ticket; for a `route-direct`
one it means the ticket body is enough to build from.

### Recording it

The route is recorded as the ticket's route field and never restated in a
comment, because a field is current state and a comment is not.

**Whoever picks the ticket up may change it**, by changing the label and
nothing else. The filer knows less about the problem than anyone who reads it
later — that holds for the route as much as for the facts. Do not leave a
comment explaining the change: the route is current state, and the same rule
applies as to the body. Nobody reading later needs the wrong version, and the
tracker keeps the revision history for anyone who does.

**`route-plan` is the one route that owes evidence**, because it is the only one
asserting a fact: that a brainstorm already settled this ticket's design.
Without proof anyone can claim it and skip the step, which is the one failure
mode that would quietly undo this whole section.

So: **attach the brainstorm's `notes.md` when you set `route-plan`.** Not at
close — now. That file is safe to attach early in a way a plan is not: brainstorm
writes it once, and the `plan` skill snapshots it write-once and never
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
- A design settled in conversation with nothing written down. Nothing to attach
  — but not nothing to record: put what was settled in `## Decisions`, and the
  ticket is `route-direct` if nothing is left to shape.

### Do not invent a lighter plan

There is no small-plan format for `route-direct` work. The moment one exists every
ticket gets one, and the ceremony the route exists to avoid grows back.

This is not the same as losing what was already decided. A decision settled
with the user before the ticket was filed lives in `## Decisions`, written as
an outcome. That needs no new section and no attachment, which is why it does
not grow into one.

## Branch

A branch is named after its ticket: the ticket reference followed by a slug.
The exact pattern is the repository's `ship.ticket-pattern` in its
`lightsout.config.json` — the configured pattern is the format's one home, and
this skill points at it rather than restating a team's spelling.

The branch is the same whichever route the ticket took. It is the one thing that
links the ticket, the worktree, the commits, the plan folder and the PR, so it
never varies.

## Plan folder

A plan folder is named exactly like its branch, so the plan, the branch and the
ticket match each other by construction. The exact spelling is the repository's
`ship.ticket-pattern` and `queue.branch-template` in its
`lightsout.config.json` — the configured pattern is the format's one home, and
this skill points at it rather than restating a team's spelling.

A plan shaped before its ticket exists carries a bare slug, and is renamed to
the canonical name when the ticket is filed. Renaming the folder is not the
whole rename: `decisions.json` and, when present, `brainstorm-decisions.json`
each carry a `planName` field that has to be updated to match, or the record
says one name while the folder says another. Nothing in the engine compares the
two, which is exactly why this skill has to.

Do not rename once a run has started. A run manifest records the plan by path,
so a folder renamed mid-run leaves `lightsout resume` pointing at a path that no
longer exists. Rename before the first `lightsout implement`, or leave the bare
slug alone and let it warn.

A folder carrying no ticket id still drafts, grades and implements from its
folder path. The engine prints one warning and nothing else changes — no exit
code moves and nothing downstream can see it.

## PR

The PR body is the ticket link, and nothing else — one line: the repository's
`ship.pr-body` template from its `lightsout.config.json`, which is where a
team's tracker conventions live.

The ticket is the source of truth. A summary,
a test plan, or a restated criterion in the body is a second copy of the
ticket, and it drifts the moment the ticket body is edited. A reviewer
needs exactly two things — the ticket and the diff — and the PR already is
the diff.

The PR title is a plain one-line description of the change, like any commit
subject.

## Keeping the body true

The body holds facts, so keep the facts current. When planning turns up a
sharper problem statement, better evidence, or an acceptance criterion that was
wrong, **edit the body to say the new thing**.

Write the new version as plain fact. "The summary holds 113 entries, none
ending `.tsx`" — not "we originally thought X, but it turned out to be Y".
Nobody reading later needs the wrong version, and the tracker keeps the edit
history if anyone does.

Editing is safe here only because the body never held a proposed fix. There is
nothing in it you can be caught out by, so every edit just makes the ticket
more accurate. The same discipline bounds `## Decisions`: edit a line only to
state more precisely what the user settled — never to record a new decision
made during shaping, whose home is the plan artifacts.

## Closing a ticket

Append one comment, two things, about a line each:

- what shipped
- the PR

Nothing else. Not the criteria and how each was verified — the checks live in
the body, and the PR's gates are the record of their passing. Not the route —
the label is the record. Not the story of getting there: what you tried, what
you gave up on, and how the finished work compared to the original ticket all
stay out. If the ticket itself turned out to be wrong, fix the body — see
above.

**There is no leftovers section.** Anything that looks left over is one of
two things. Decided against — then it is a decision, already recorded where
decisions live, and writing it again here resurrects it. Still wanted — then
it deserves its own ticket, which only the user can approve; once that
ticket exists, the tracker's issue links are the record and prose adds nothing.
There is no third category. If a real candidate is on the table at close,
ask the one question — "want a ticket for X, or let it go?" — and write
nothing either way.

If implementation amended a published plan, publish the current version before
closing (see below); do not restate its decision table in the comment.

## Publishing the plan

The `plan` skill writes `.lightsout/plans/<name>/` — either `plan.md`, or
`overview.md` with phase files, alongside durable records such as
`decisions.json` and `grade.json`. That is the design record: what was decided,
what was rejected, and why. The folder to publish is the one named after this
ticket, so it is found by reading the ticket id off the folder name rather than
by recognising a slug.

Those files live on one machine. `.lightsout` is gitignored, so the path is not
a link — it resolves for nobody but the author, and not for the author on a
different laptop. Never paste a filesystem path into a ticket and call it a
reference.

A `route-direct` ticket has no plan folder and nothing to attach. That is expected —
its `## Decisions` section is the decision record.

A `route-brainstorm` ticket that stopped at "just build it" wrote no files
and has nothing to attach. What was settled in that conversation goes into
the ticket's `## Decisions` before building — the body is where decisions
live, never the closing comment.

**Only the durable set travels when the route produced a plan:**

| file | what it holds |
|---|---|
| `notes.md`, when present | the brainstorm: the idea in the user's words, the scope call, the approach chosen and the ones rejected |
| `plan.md`, or `overview.md` plus every `phase<N>-<slug>.md` | the complete single or phased plan that was built |
| `decisions.json`, when present | every question asked, the option chosen, and why — including which choices were assumptions nobody confirmed |
| `grade.json`, when present | the latest grade and the lenses that produced it |

Publish also writes `plan-attachments.json` last. It is a small transport
integrity marker, not a plan record or run transcript: it names the exact
durable files in that generation and their SHA-256 hashes so a fresh machine
can reject an interrupted or mixed upload before writing anything to disk.

A `route-auto-plan` ticket publishes the same durable set; when no brainstorm
ran, its `notes.md` is the one the `auto-plan` skill wrote for itself from the
ticket before planning.

Do not assemble or attach that set by hand. Run `lightsout plan publish --name <name>`
from the machine holding the plan folder. It resolves the complete plan
deliverable plus the durable records that are present and uploads each as a
separate attachment under the file's own name. It refuses when no runnable plan
deliverable exists. A re-publish replaces every same-titled attachment rather
than doubling it, and reports any differently titled durable-looking artifact
left from an earlier publish without deleting it. Those older titles are not
restored unless the new integrity marker names them.

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

Skip `grade-history.jsonl` for the same reason. It is the append-only record of
every grading pass a plan ever had: its last line is the same report the
attached `grade.json` already carries, and the earlier lines are how the plan
got there — which finding kept coming back, and how many re-grades it took. That
is a debugging artifact, not something a person picking up a ticket reads. Keep
it on disk and attach nothing.

### Publish when the ticket is ready to implement, not at close

For any route that produced a plan, publishing is the mechanical
ready-to-implement step. Run `lightsout plan publish --name <name>` when the
route completes, before moving the ticket to **Ready to implement**. Waiting
until close assumes whoever builds it is whoever planned it, on the machine
that planned it — the assumption this whole system exists to break.

As part of that same transition, drain `## Open questions`: delete every line
the shaping answered, then move the ticket only after publish succeeds. The
answers — the "no"s included — are in the Decision Log being published, so the
questions leave the body as their answers become durable on the ticket.

`.lightsout` is gitignored. Until these files are published, a plan exists on
exactly one laptop, and any other agent picking up that ticket sees a problem
statement with none of the shaping behind it.

A published plan makes the ticket both **readable** and **runnable** by a fresh
agent. Nothing has to be rebuilt by hand: point the `implement` skill at
`.lightsout/plans/<name>`. The engine uses the folder on disk when it exists.
When it does not, the engine reads the ticket id from the canonical folder
name, fetches that ticket's durable attachments and reconstructs the folder
before implementation starts. Run state never travels.

Re-publish before close if implementation amended the plan. Each same-titled
attachment is replaced, so the ticket keeps the current durable record rather
than two competing versions.

Do not paste the plan into the ticket body. An attached file cannot drift.

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
- **Reading a check as a ceiling.** A criterion that named only one step was
  nearly read as a decision to scope the fix to that step. Criteria record the
  observed case; only `## Decisions` narrows scope.
- **Resurrecting a rejection.** An idea the user declined during planning was
  read from `## Open questions` as unfinished work, and a ticket was filed for
  the thing the user had said no to. A "no" is a decision — record it as one
  and delete the question.
- **Filing an unapproved ticket.** An agent read "we'll move this later" as
  a yes and filed the ticket itself, at close, unprompted. The user never
  saw it before it existed and may never have wanted it. Deferral is a
  candidate; only the user's yes to the specific ticket is approval.
