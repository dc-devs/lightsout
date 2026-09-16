---
name: auto-plan
description: Plan a ticket alone — the engine answers every question below a written escalation bar, stops at the ones that are genuinely yours, and rolls onward per the auto-plan config block. Use when the user asks to auto-plan a ticket, plan it without the interview, or hand a ticket straight to the factory. Input is a ticket, a feature description, or a rough-notes file path. Output feeds the `implement` skill.
allowed-tools: Bash, BashOutput, Read, Write, Edit, Grep, Glob, Task
---

# lightsout: auto-plan

**This skill is the interactive conductor, not the engine.** It runs the same
planner the `plan` skill runs, with one difference: `--mode automatic`, which
tells the engine to answer every question it can and stop only at the ones that
are genuinely the user's. Everything else is identical — the same records, the
same investigation, the same independent challenge before drafting and after it,
the same repair-and-verify, the same derived readiness.

**Do not add gates, retries, caps, repair budgets or contract parsing here.**
There is no worker loop to run, no round limit to count and no re-draft to
order. Do not read `.planning/` and do not keep a state machine beside the
engine's.

**Under `lightsout queue` this skill is not invoked at all.** The queue runs the
planner itself, in its own process, and then runs the build. Nothing below
applies there.

Resolve the plugin root once from this loaded skill's absolute path: it is two
directories above this `SKILL.md`. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` may
provide the same path; do not assume that variable exists in Codex skill shell
calls. Use the resolved absolute path wherever `<plugin-root>` appears below.
Confirm `<plugin-root>/dist/cli.mjs` exists; otherwise stop and tell the user to
reinstall the plugin or run `pnpm bundle`.

## Question format

When this skill does put a question to the user — an escalation the engine
raised, a parked question, a vetoed digest row — it uses the labeled four-part
shape (**Context**, **Question**, **Options**, **Recommendation**) documented in
the plan skill, which is the authoritative copy and lives at
`<plugin-root>/skills/plan/SKILL.md`. Read it there rather than recalling it.
Its durable-delivery rule applies here too: put every complete question block in
the final response that waits for the user's answer, never only in commentary.
Two other rules are the easiest to lose and are repeated here: **never ask
through an option-picker tool** — every question is written out in that final
response, because a picker's one-line labels cannot carry a Context or an
Options list — and **one full-format question per final response**.

## The escalation bar

This is the bar automatic mode applies. The engine applies it; this section says
what it means, so a question that arrives can be recognised for what it is and
relayed rather than second-guessed.

A question is the user's only when **both** hold:

1. Two reasonable engineers, given everything already settled, would choose
   differently.
2. The difference is visible to the user or to the product — a name they will
   read, a behaviour they will see, a cost they will pay, or a decision they
   will live with.

Fail either one and it is not theirs.

**A best-practice question never escalates, however hard it is.** How to
structure a file, which existing pattern to mirror, what to name a private
helper, where a test goes, how to keep a function under the size cap — the
standards and the surrounding code answer these, and a user who is asked one
learns nothing they did not already delegate.

**A question that clears the bar is never planned past.** It arrives as an
`awaiting-user` result carrying its own context, options and recommendation, and
nothing moves until it is answered. Without `auto-approve-plan` you ask it and
carry on; with `auto-approve-plan` the run parks — see
[Parking a run](#parking-a-run).

**You do not lower the bar and you do not raise it.** Relay what arrives. Do not
answer an escalation on the user's behalf because a run is taking a while, and
do not manufacture one because a decision feels weighty — the engine already
made that call from the record, which is more than this session can see.

## What is already settled

**A settled decision is never re-asked, and you are not the one who decides
that.** The engine holds the settled claims, the confirmations behind them and
the questions it has already had answered; it does not raise a question whose
answer is on the record. A question that reaches you is one the record cannot
answer.

**Brainstorm alignment is inherited, not re-interviewed.** When the work traces
to a `/brainstorm` that reached alignment, the product direction it settled is
already in the record along with the technical questions it delegated. Do not
re-open any of it.

**The user's latest explicit instruction still outranks the record.** Follow it,
and say so plainly in the answer you send back so the record carries the
supersession.

**On a ticket holding several plans, an earlier plan's records are context.**
Read them for what was built and why. A change to a plan whose implementation is
finished belongs in **this** plan, never in an edit to that one.

## Steps

**0. Read the config.** Read `lightsout.config.json` at the repo root and take
its `auto-plan` block. A missing file, a missing block or a missing key all mean
`false`. State the three resolved values back in one line before doing anything
else, so the user knows which checkpoints are live — for example:

```
auto-plan: propose after drafting · implement on approval · proposal required
```

These keys decide **which checkpoints stand**, never how thoroughly the plan is
worked, and they are not standing product approval: a product decision the
planner reaches later still stops the run with its own question whatever the
block says.

**1. Name the plan and open its tree.** Naming follows the plan skill's step 1 —
`ticket show`, then the lowest-numbered plan still at `planning` or a plan added
with `ticket add-plan` — with two differences of this skill's own.

A switch to multiple-plan mode changes whether the ticket ships on its own, so it
is the user's: ask it, or park it under `auto-approve-plan`. And this skill never
adopts a ticket folder holding files from before ticket records: it plans that
folder as it stands and names `lightsout ticket adopt` in the digest.

With no ticket, derive a kebab `<name>` from the request. When the request is a
rough-notes file path, read it before anything else; when it already lives under
the plans directory, take `<name>` from the path segments below that directory.

Then, as the very first shell command after `<name>` is settled:

```sh
node "<plugin-root>/dist/cli.mjs" plan workspace --name <name>
```

Work from the absolute path it prints. A nonzero exit is the end of the run —
report the sentence it printed and stop.

**2. Capture what the user actually asked for.** Write one `PlanningInput` JSON
file holding the **original wording** — the ticket's own title and description,
the user's request, the rough notes — the claims made from it, and a confirmation
per settled user claim carrying the message where they said it.

The shape is strict. Each `sources` entry carries the text and the SHA-256 of
exactly that text; a claim with `"owner": "user"` and `"state": "settled"` names
the `confirmationId` that settles it; that confirmation's `approvedDigest` is the
digest of the source the claim came from.

**Never invent a source, a confirmation or an approval the user did not give.**
This skill answers questions on the user's behalf; it does not get to record
their approval. A self-answer is a planner decision and belongs in the digest,
not in a confirmation.

A plan continuing from an aligned brainstorm already has its record — pass
`--input-file` only for material that is genuinely new. A plan folder of the
older shape needs no input file at all.

**3. Run the planner in automatic mode.**

```sh
node "<plugin-root>/dist/cli.mjs" plan run --name <name> --mode automatic [--input-file <path>]
```

It investigates, settles the design, has it challenged before drafting, drafts,
has the draft challenged again, repairs and verifies each finding, and reviews
the whole — answering every question below the bar itself. It prints one typed
result and exits.

- **`awaiting-user`** — either a question that cleared the bar, or the proposal
  checkpoint the config left standing. Handle it per step 4, then send the answer
  back:

  ```sh
  node "<plugin-root>/dist/cli.mjs" plan answer --name <name> --mode automatic --answer-file <path>
  ```

  The answer file repeats the `questionId`, `checkpointRevision` and
  `questionDigest` the result printed, plus the option picked or the text typed,
  plus a confirmation carrying the user's message. An answer naming a checkpoint
  the plan has moved past is refused rather than applied to the wrong question —
  re-run `plan run` and handle what it asks now.

- **`complete`** — readiness was derived from the records and persisted with the
  generation it certifies. Go to step 5.

- **`externally-blocked`** — report the `cause` it printed and stop.

Re-run `plan run` after each answer, until it prints `complete` or
`externally-blocked`. A below-par grade is not a place to stop and neither is a
long run: what ends this is the engine's result.

**4. The proposal.** When the result is the proposal checkpoint, make it one
final response. It carries, in this order:

- what the plan builds, in plain words — two or three sentences, no jargon;
- **the assumption digest**: a table of every question this session answered for
  itself — the question, the choice, the one-line why — in the order they were
  made;
- the counts the plan states (files created, files touched) and where the plan
  folder is on disk;
- what approval does next, read from the config: start the build, or stop.

Then the ask, in one line: approve, veto specific digest rows, or change
direction.

- **Approval** is sent as the answer, with a confirmation carrying the user's
  own approving message.
- **A veto re-opens exactly that question.** Ask it live in the Question format
  and send the corrected answer back through `plan answer`. Never edit the plan
  files by hand to apply it — the answer belongs in the record, and a hand edit
  is authority the engine cannot see.
- **A change of direction is a stop.** Say plainly that this is what the
  interactive `plan` skill is for, and hand the plan folder over.

When the result is a question rather than the proposal, it cleared the bar: ask
it in the Question format, one at a time, before the proposal — or park it, per
[Parking a run](#parking-a-run).

**5. Publish the approved ticket-backed plan.** Once the planner has printed
`complete` and the work traces to a ticket:

```sh
node "<plugin-root>/dist/cli.mjs" plan publish --name <name>
node "<plugin-root>/dist/cli.mjs" ticket-state --ref <ticket> --planning-status planning-complete --tracker-status ready
```

A successful publish is what moves this plan from `planning` to `ready` on the
ticket's record. A nonzero exit from either is a stop: report the exact failure
and do not hand off or implement an artifact another machine cannot recover.
A plan whose citations rest on evidence that cannot travel stays blocked at
publish rather than being published in a form that no longer proves what it
claims — report what it says.

Never treat a `complete` result as a substitute for these commands: readiness
proves the plan is ready, publish makes that ready plan durable.

With no ticket, skip both commands.

**6. Roll onward.** With `implement-on-approval` false, print the handoff line
and stop:

```
Next: run the `implement` skill with .lightsout/plans/<name>
```

On a multiple-plan ticket, add the line the plan skill adds: the ticket stays
open until the user files a ship request with `lightsout ticket request-ship`.
Never file one yourself.

With it true, read `<plugin-root>/skills/implement/SKILL.md` and follow it in
full, using `.lightsout/plans/<name>` as the provided plan path, just as if the
user had invoked `implement` directly. That includes backgrounding the
implementation, starting `status --watch`, relaying every progress block
verbatim until the watch exits, and then relaying the engine's final report.
Running the implementation CLI alone skips the watch and is not the handoff.

The engine performs the In Progress write itself at the `implement` edge and
refuses to start when it fails, so this skill writes nothing further. Whether
that run then chains into ship is the `ship` block's business inside the engine,
not this skill's.

## Parking a run

When `auto-approve-plan` is true and the engine raises a question, there is no
proposal to carry it in and this skill does not guess past it. It:

- stops, leaving the plan exactly where the engine left it;
- when the work traces to a ticket, appends the question to that ticket's
  `## Open questions` section, creating the section when absent, following the
  ticket-workflow skill at `<plugin-root>/skills/ticket-workflow/SKILL.md` —
  written as a question, never as a prescription. Neither field is written: the
  ticket keeps `planning-ready-auto-plan` and its current tracker status. A
  parked run is waiting on a human, and reclassifying the ticket underneath them
  would hide that;
- when there is no ticket, states the question in the final response instead;
- reports the plan folder path, and says that `plan answer`, the interactive
  `plan` skill, or a re-run after the question is settled continues the work from
  where it stopped.

`auto-approve-plan` means *do not wait for me when nothing needs me*. It never
means *guess past what does*.

## Diagnostics

`lightsout status --planning <name>` shows what the records hold: the work items
and their states, the blocking findings still open, the saved conclusions
available for reuse, the findings repaired and verified, what the recorded
provider calls cost, and the outcome of the implement run this repository holds
for the plan.

Read it as it is written. Detail the records do not hold is shown as
unavailable, and relaying it as a zero, a pass or a saving is a claim the records
do not support. Planning cost is never an implementation outcome, and a low one
is not evidence that anything worked.

## What this skill never does

- It adds no engine subcommand and changes no engine planning machinery. Every
  deterministic step is the engine's, reached through `plan run` and
  `plan answer`.
- It never edits the plan or brainstorm skills. Those are the manual route and
  stay exactly as they are.
- It does not lower the escalation bar because a run is taking long.
- It does not edit plan files by hand to settle a question.
- It does not record a confirmation the user did not give.
