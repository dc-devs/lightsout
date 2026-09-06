---
name: auto-plan
description: Plan a ticket alone — self-answers every question below a written escalation bar, shows you one proposal, and rolls onward per the auto-plan config block. Use when the user asks to auto-plan a ticket, plan it without the interview, or hand a ticket straight to the factory. Input is a ticket, a feature description, or a rough-notes file path. Output feeds the `implement` skill.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Task
---

# lightsout: auto-plan

**This skill is the interactive conductor, not the engine.** All determinism —
fact verification, the draft↔structural-lint loop, dedup detection, grading —
lives in the `lightsout plan …` subcommands as deterministic code. **Do not add
gates, retries, caps, or contract parsing here.** What is particular to this
skill: **it answers the questions the plan skill puts to the user, and stops
only at the checkpoints the config leaves standing.**

Resolve the plugin root once from this loaded skill's absolute path: it is two
directories above this `SKILL.md`. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` may
provide the same path; do not assume that variable exists in Codex skill shell
calls. Use the resolved absolute path wherever `<plugin-root>` appears below.
Confirm `<plugin-root>/dist/cli.mjs` exists; otherwise stop and tell the user to
reinstall the plugin or run `pnpm bundle`.

## Question format

When this skill does put a question to the user — an escalation, a parked
question, a vetoed digest row — it uses the labeled four-part shape
(**Context**, **Question**, **Options**, **Recommendation**) documented in
the plan skill, which is the authoritative copy and lives at
`<plugin-root>/skills/plan/SKILL.md`. Read it there rather than
recalling it. Its durable-delivery rule applies here too: put every complete
question block in the final response that waits for the user's answer, never
only in commentary. Two other rules are the easiest to lose and are repeated
here: **never ask through an option-picker tool** — every question is written
out in that final response, because a picker's one-line labels cannot carry a
Context or an Options list — and **one full-format question per final response**.

## The escalation bar

**This section is a cross-skill contract.** The `brainstorm` skill reads it
here, at `<plugin-root>/skills/auto-plan/SKILL.md`, to test the questions its
probe turns up — so there is one definition and no second copy. Do not rename
the heading or move the section without updating that reader.

Escalate a question to the user only when **both** of these hold:

1. Two reasonable engineers, given everything already settled, would choose
   differently.
2. The difference is visible to the user or to the product — a name they will
   read, a behaviour they will see, a cost they will pay, or a decision they
   will live with.

Fail either one and you answer it yourself.

**A best-practice question never escalates, however hard it is.** How to
structure a file, which existing pattern to mirror, what to name a private
helper, where a test goes, how to keep a function under the size cap — the
standards and the surrounding code answer these, and a user who is asked one
learns nothing they did not already delegate.

**When you are unsure whether a question clears the bar, answer it yourself and
put it in the digest.** This is the opposite of the plan skill's "when in doubt,
escalate", and deliberately so: a wrong self-answer costs one plan edit at the
proposal, where every self-answer is listed and veto-able, while a needless
escalation costs the thing this skill exists to save.

**A question that clears the bar is never planned past.** Without
`auto-approve-plan` it becomes an unscheduled checkpoint: ask it in the Question
format, one at a time, before the step that depends on it, then fold the answer
in and carry on. Under `auto-approve-plan` the run parks instead — see
[Parking a run](#parking-a-run).

## Convergence invariant

**A grade below A is never a terminal success state.** Treat a grader's
`needs-a-human` or `unjudged` label as evidence to evaluate through this
skill's escalation bar, not as authority to stop the run. For every finding
below the bar, resolve it from the approved scope, recorded decisions, and
repository conventions; update the plan and decisions; then re-run the
applicable validation, deduplication, and grade checks.

**Convergence budget.** After the initial grade, perform at most **two**
repair rounds. Each round resolves every below-bar finding, records the
decisions, runs the applicable validation and deduplication checks, then grades
again — and each regrade is mostly mechanical, because the deterministic checks
re-run for free. A passed, complete grade (A) proceeds normally.

If both rounds are spent and the plan remains below A, preserve the complete
grade history and present the remaining gaps and the changes the rounds made.
Ask the human to choose exactly one: authorize one more round, explicitly accept
the current below-A plan and proceed to implementation, or change direction /
settle a genuine product-level decision. Do not auto-approve or auto-implement a below-A plan.
Only an explicit human acceptance may bypass the A-grade requirement; record it
in the plan's Decision Log and `decisions.json` before rolling onward.

The only exception is a question that genuinely clears the escalation bar:
one that cannot be resolved from the record and whose alternatives visibly
change the product. Park that question using the configured parking path. Do
not manufacture such an escalation because convergence is inconvenient or a
grader labeled it `needs-a-human`.

## Settled decisions

**Settled means settled — never re-answer it.** Before routing any question
through the bar, check whether the answer is already on the record. Three
records count, and all three are the user's:

| Where | Holds |
|---|---|
| `.lightsout/plans/<name>/brainstorm-decisions.json` | what was settled with the user in a brainstorm before this session |
| `.lightsout/plans/<name>/decisions.json` | what was settled earlier in this run |
| the drafted plan's `## Decision Log` | the rows of both, plus every answer folded in since the draft |

A settled question is **dropped**, not answered again: no new `Decision Log`
row, no new decisions row, and it never enters the bar's routing at all.

**Re-open a settled decision only for a contradiction you can name at a
specific `file:line`.** A re-opened decision is recorded as a **new** row that
**repeats the original row's `question` text verbatim**, with a rationale naming
the `file:line` and saying which row it supersedes — the plan writer treats the
last row sharing a question as the live one. Never edit
`brainstorm-decisions.json`; brainstorm owns it, and both rows belong in the
log.

**A settled decision is not a self-answer.** It never enters the assumption
digest, because the user already made it.

## Steps

**0. Read the config.** Read `lightsout.config.json` at the repo root and take
its `auto-plan` block. A missing file, a missing block or a missing key all
mean `false`. State the three resolved values back in one line before doing
anything else, so the user knows which checkpoints are live — for example:

```
auto-plan: propose after drafting · implement on approval · proposal required
```

**1. Name the plan and gather the source.** A plan folder is named exactly like
its branch. A queue worktree is always already on the ticket's branch, so
`<name>` is the current branch name verbatim and no derivation runs at all.
Outside a worktree, when the work traces to a ticket, `<name>` is the lowercased
ticket id followed by a slug of the title — the same string the branch is, whose
exact shape is the repository's `ship.ticket-pattern` and
`queue.branch-template` in its `lightsout.config.json`. With no ticket, derive a
kebab `<name>` from the request (e.g. "add a rate-limit banner" →
`rate-limit-banner`), and rename the folder to the canonical name when the
ticket is filed — the ticket-workflow skill's `## Plan folder` section says what
else a rename has to update, and when it is too late to do one. When the request
is a rough-notes file path, read it before anything else; when it already lives
at `.lightsout/plans/<name>/brainstorm-notes.md`, take `<name>` from its folder rather than
deriving a new one. Read `.lightsout/plans/<name>/brainstorm-decisions.json`
when it exists — its rows are already settled with the user. In a fresh
worktree it may not be on disk yet: `plan verify-facts` in step 2 fetches the
brainstorm the ticket carries, so the folder is read again there.

When the work traces to a ticket, read the ticket and follow the
ticket-workflow skill at `<plugin-root>/skills/ticket-workflow/SKILL.md`:
its `## Decisions` lines are settled
rows, its `## Open questions` are this run's agenda, and its acceptance criteria
are floors, never ceilings.

**2. Explore and verify the facts.** Read the files the request touches, follow
the integration points, and note real signatures; for a feature spanning many
packages, optionally fan out read-only Explore subagents for breadth — either
way YOU author the facts, and only from paths you confirmed by reading them.
Author `.lightsout/plans/<name>/facts.json` in the **exact** shape the plan
skill documents (the engine hard-parses it). Then run:

```sh
node "<plugin-root>/dist/cli.mjs" plan verify-facts --name <name> [--notes "<path>"]
```

**That command also fetches the brainstorm the ticket carries** — both
`brainstorm-notes.md` and `brainstorm-decisions.json` — into
`.lightsout/plans/<name>/`, before it reads anything. So they have now landed in
the folder even in a fresh worktree that never saw them, and they must be read
there before the interview is routed. Step 3's `Settled decisions` check reads
them at that point, not before.

Pass `--notes` when the request came from a rough-notes file. **When the run
traces to a ticket instead, author the notes yourself first** — the idea in the
ticket's words, the scope call, the approach chosen and the ones rejected with a
one-line why — write them to a temporary path and pass that via `--notes`, so
the frozen `brainstorm-notes.md` carries this self-brainstorm's reasoning the way it would
carry a human brainstorm's. The snapshot is write-once; re-running verify-facts
never clobbers it. **Skip the self-authored notes entirely when `verify-facts`
fetched a `brainstorm-notes.md` from the ticket**: that file is the brainstorm's
own record, the write-once snapshot already makes it win, and authoring a second
one only invites this skill to believe its own summary is the record.

Fix any genuinely wrong path in facts.json and re-run verify-facts. While
reading, deliberately check each settled brainstorm decision against the code
and note any conflict with the exact `file:line`.

**3. Answer the interview yourself.** Work the plan skill's Elicitation agenda
— the scope check, the global-constraint collection, the harvest of the session
and of the ticket, the brainstorm hand-off — but route every item through the
escalation bar instead of asking it.

- **Harvested rows are settled.** Decisions the user already made in this
  session, in the ticket's `## Decisions`, or in a brainstorm row are recorded
  with `"assumption": false` and never enter the digest.
- **Every self-answer is a row** with `"source": "Elicitation"` and
  `"assumption": true`.
- **Global constraints.** A project-wide rule the user has already stated (in
  the ticket, in the session, or in a brainstorm row) gets its own row whose
  `question` begins exactly `Global constraint:`. Do **not** invent one; when
  none was stated there are no such rows and the plan's section will read
  `None`.
- **The scope call** — one plan, one phased plan, or several independent plans
  — clears the bar whenever it would split the ticket into more than one plan,
  because that decides what gets built. A single-versus-phased call does not:
  the engine makes its own estimate at draft time.
- **There is no alignment checkpoint to earn.** This skill's licence to
  self-answer is the bar, and the user granted it by invoking the skill.
- Author `.lightsout/plans/<name>/decisions.json` in the **exact** shape the
  plan skill documents: `planName`, plus a `decisions` array of
  `source` / `question` / `options` / `choice` / `rationale` / `assumption`.

**4. Propose early** (only when `propose-before-draft` is true). Show the
proposal now, before any engine agent spends: the design shape in plain words,
the digest of step 3's self-answers, and the plan folder path. Run step 8's
proposal handling. On approval, continue to step 5 and show no second proposal.

**5. Draft.** Run:

```sh
node "<plugin-root>/dist/cli.mjs" plan draft --name <name>
```

Pass `--scope single|phased` only to override the engine's estimate. On a facts
error, correct facts.json, re-run verify-facts and re-draft. On remaining
structural issues on a phased plan, resplit the overview's `## Phases` table and
its `## Phase Declarations` to spread the creates across more phases, then
re-run draft.

**6. Grill it yourself.** Generate the same relentless stream of edge-case
questions against the drafted plan; grilling intensity never drops. The pass
interrogates the contract — the file map, the exported signatures, the file each
new file mirrors, and the acceptance-test ledger — because that is what a plan
carries that a test cannot state for itself.

- **Drop** a question the record already answers, with no new row.
- **Route the rest through the bar.** Self-answered → fold the answer into the
  plan file via Edit, append a `Decision Log` row with `Source = Grill` and a
  rationale ending `(self-answered)`, and mirror it into decisions.json with
  `"assumption": true`. Above the bar → an unscheduled checkpoint, or a park
  under `auto-approve-plan`.
- **Stop rule.** The plan skill grills until the user says stop; there is no
  user here, so: **stop when one complete pass over every plan file produces no
  question whose answer would change the plan.** A second pass that only
  re-treads settled ground is the signal. An unbounded loop with no human in it
  does not terminate on its own.

**7. Dedup and grade.**

```sh
node "<plugin-root>/dist/cli.mjs" plan dedup --name <name>
```

Read `.lightsout/plans/<name>/dedup.json`. Every finding's `recommendation` is a
best-practice call and therefore below the bar: **auto-accept them all**, and
apply each resolution to the plan file the finding's `phase` names — `reuse`
drops the Files-to-Create entry and wires the plan's usage to the existing
symbol; `extend` adds a Files-to-Modify entry for it; `extract` adds the shared
file at `suggestedLocation` plus a Files-to-Modify entry per `migrateCallers`;
`defer` leaves the entry and records the accepted duplication in `## Prior Art`;
`distinct` records the justification there. Append a `Decision Log` row
`Source = Dedup` for each. A finding whose resolution the record already carries
is applied from the record, not re-decided. `"complete": false` means the scan
was partial — resolve what is there and re-run dedup.

```sh
node "<plugin-root>/dist/cli.mjs" plan grade --name <name>
```

Read `.lightsout/plans/<name>/grade.json`. `"passed": true` **and**
`"complete": true` → go on. Otherwise take the blocking gaps (`needs-a-human`
and `unjudged`), route each through the bar, and resolve the below-bar ones by
editing the plan file the gap's `phase` names — plus a `Decision Log` row
`Source = Converge`, mirrored into decisions.json — then re-grade. **Never
re-run `plan draft`**: it regenerates the plan files and would clobber every
edit folded in since.

- **Convergence rule.** A below-A grade is work to do, not a proposal input.
  Apply the [convergence invariant](#convergence-invariant): resolve every
  below-bar gap, record the decision, re-run validation and deduplication when
  the edit affects them, and re-grade until the result is passed and complete
  or the two repair rounds are spent. Do not stop merely because two grades
  have similar findings, a run is taking a long time, or the grader used a
  `needs-a-human`/`unjudged` label.

**8. The proposal.** One final response, unless `auto-approve-plan` is true
and nothing cleared the bar. The proposal and its approval request are the
deliverable for that turn: do not put any part only in commentary. It carries,
in this order:

- what the plan builds, in plain words — two or three sentences, no jargon;
- **the assumption digest**: a table of every self-answered question — the
  question, the choice, and the one-line why — in the order the rows were made;
- any question that cleared the bar and any gap left unresolved, each in the
  Question format;
- the counts the plan states (files created, files touched) and where the plan
  folder is on disk;
- what approval does next, read from the config: start the build, or stop.

Then the ask, in one line: approve, veto specific digest rows, or change
direction.

- **A veto re-opens exactly that question.** Ask it live in the Question format,
  fold the corrected answer into the plan file via Edit, append a `Decision Log`
  row with `Source = Converge`, mirror it into decisions.json, re-grade, and
  show a short amended digest. Never re-draft.
- **A change of direction is a stop.** Say plainly that this is what
  the interactive `plan` skill is for, and hand the plan folder over.

**9. Publish the approved ticket-backed plan.** Once approval exists — explicit
or automatic — and before either handing off or implementing, publish when the
work traces to a ticket:

```sh
node "<plugin-root>/dist/cli.mjs" plan publish --name <name>
```

Then write the ticket's planning status. **The command differs between the two
ways this skill runs.**

Interactive run — the planning status and the tracker status move together:

```sh
node "<plugin-root>/dist/cli.mjs" ticket-state --ref <ticket> --planning-status planning-complete --tracker-status ready
```

Headless under `lightsout queue` — the planning status alone:

```sh
node "<plugin-root>/dist/cli.mjs" ticket-state --ref <ticket> --planning-status planning-complete
```

Under the queue the ticket is **already In Progress**: the queue records that
before this worker's agent starts. Passing `--tracker-status ready` there would
move the ticket backwards out of In Progress while a live worktree still owns
its branch — and `planning-complete` at Ready to implement is one of the three
pairs the queue selects, so a later drain could pick up work already underway.
The build the queue runs after this session ends would then write In Progress a
third time. Omitting the flag writes the planning status and leaves the tracker
status alone.

With no ticket, skip both commands. A nonzero exit from either is a stop: report
the exact failure and do not hand off or implement an artifact another machine
cannot recover. Under `lightsout queue`, report that as `failed` in the worker's
final JSON so the ticket parks with the actionable error. Never treat a
passing grade or automatic approval as a substitute for these commands; the
grade proves the plan is ready, while publish makes that ready plan durable.
Writing `planning-complete` here is what the implement run finds and preserves —
step 10's run interactively, and the queue's own engine-owned build under
`lightsout queue` — so the ticket never enters In Progress still claiming
shaping is owed.

**10. Roll onward.** Under `lightsout queue` this step does nothing at all,
whatever `implement-on-approval` says: stop after step 9's publish and report
`complete`. The queue runs the implement pipeline on the plan folder itself,
outside this session, because a build started inside an agent session dies when
that session does.

Otherwise, with `implement-on-approval` false, print the handoff line
and stop:

```
Next: run the `implement` skill with .lightsout/plans/<name>
```

With it true, run:

```sh
node "<plugin-root>/dist/cli.mjs" implement --plan ".lightsout/plans/<name>"
```

and relay the engine's report to the user verbatim. The engine performs the In
Progress write itself at the `implement` edge and refuses to start when it
fails, so this skill writes nothing further. Whether that run then chains into
ship is the `ship` block's business inside the engine, not this skill's.

## Parking a run

When `auto-approve-plan` is true and a question clears the bar, there is no proposal
to carry it in and the skill does not guess past it. It:

- stops before the step that depends on the answer;
- when the work traces to a ticket, appends the question to that ticket's
  `## Open questions` section, creating the section when absent, following the
  ticket-workflow skill at `<plugin-root>/skills/ticket-workflow/SKILL.md`
  — written as a question, never as a
  prescription. Neither field is written: the ticket keeps
  `planning-ready-auto-plan` and its current tracker status. A parked run is
  waiting on a human, and reclassifying the ticket underneath them would hide
  that;
- when there is no ticket, states the question in the final response instead;
- reports the plan folder path, and says that the interactive `plan` skill or a re-run
  after the question is settled continues the work.

`auto-approve-plan` means *do not wait for me when nothing needs me*. It never means
*guess past what does*.

## Parking under `lightsout queue`

When this skill runs headlessly under `lightsout queue`, there is no user in
the session to park a question to, and no ticket step to write it on. The
parking above does not apply. Instead:

- stop before the step that depends on the answer;
- report `terminated:ambiguity` as the final JSON, with the question as the
  first entry of `failures`, and stop there — nothing is written to the ticket
  from inside the session.

The engine relays the question to the terminal that started the queue, writes
the answer to the run's decisions file and to the ticket's `## Decisions`
section, and re-invokes with it. The worktree keeps whatever was already done,
so the re-invocation continues rather than starting over.

## What this skill never does

- It adds no engine subcommand and changes no engine plan machinery. Every
  deterministic step is the `lightsout plan …` subcommands as they already
  stand.
- It never edits the plan or brainstorm skills. Those are the manual route and
  stay exactly as they are.
- It does not lower the bar because a run is taking long.
- It does not skip Dedup or Grade to reach the proposal sooner.
