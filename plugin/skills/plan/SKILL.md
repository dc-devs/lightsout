---
name: plan
description: Produce a rigorous, implementation-ready plan for a feature — one a fresh-context agent can implement without guessing. Investigates the codebase, challenges the design before drafting and the draft afterwards, and asks you only the decisions that are genuinely yours. Use when the user wants to plan a feature, write an implementation plan, or get a plan ready before implementing. Input is a feature description or a rough-notes file path. Output feeds the `implement` skill.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Task
---

# lightsout: plan

**This skill is the interactive conductor, not the engine.** The engine owns the
planning loop: which role runs next, what a role is handed, whether its answer is
accepted, which questions are genuinely the user's, and whether the plan is
ready. This skill's whole job is to name the plan, capture what the user
originally said in the shape the engine ingests, put the engine's questions to
the user in a form they can answer, and send the answers back.

**Do not add gates, retries, caps, stage schedules or contract parsing here.**
There is no reader count to set, no repair budget to spend and no re-draft to
order. Do not read `.planning/` and do not keep a state machine beside the
engine's — a second scheduler is the one thing that can make this skill lie about
what the engine did.

**What the engine decides, you relay.** The engine's printed result is the only
branch you make: `awaiting-user` means ask, `complete` means readiness was
derived, `externally-blocked` means stop and report.

Resolve the plugin root once from this loaded skill's absolute path: it is two
directories above this `SKILL.md`. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` may
provide the same path; do not assume that variable exists in Codex skill shell
calls. Use the resolved absolute path wherever `<plugin-root>` appears below.
Confirm `<plugin-root>/dist/cli.mjs` exists; otherwise stop and tell the user to
reinstall the plugin or run `pnpm bundle`.

## Question format

**Pick the shape from what the answer is.** Before writing the question,
ask: does answering it mean inventing a name or a short phrase the code or
the user will see — a value, a state, a field, a flag, a message? Two or
more of them: draft the real names as a table under **Options**, one row
each, first column the name, second column a short description of what that
thing is. Exactly one: write the drafted wording out inline, in full, rather
than describing it. Any other question stays prose. The labeled parts below
apply either way — this test only decides whether the names get written down
or talked about, and the 1–3 sentence target counts sentences, not table
rows.

Every question this skill puts to the user uses this labeled four-part shape, in
this order. The engine writes each question's context, options and
recommendation; this shape is how they reach the user.

**Context:** what the question is about and why it matters, in everyday
words. Write for someone who has not read the plan or the code — never
assume they know the plan's internals. State the problem the question
decides — in everyday words — before naming any options.

**Question:** the question itself, one sentence.

**Options:** the answers to choose between, one per line, each opening with a
bracketed number and its name — `(1) <name>: …` — then what it wins and what it
costs. The number is there so the user can reply with the digit alone; the name
is what makes the list readable to someone who skipped the paragraphs above.
When an option carries risk, say what goes wrong if it fails and what catches
it.

**Recommendation:** the option you recommend, named by its number, and the
one-line why — so a reply of just that number resolves it.

**Presentation.** Each labeled part is its own short paragraph — bold label,
blank line between parts. No bullet dashes on the labels; the blank lines
are what keep the block readable.

**Extra parts are welcome when needed.** If something the user must know
fits none of the four labels (a safety note, a cost, a deadline effect),
add another bold-labeled paragraph rather than forcing it in or leaving
it out.

**Plain language, always.** No jargon. Never use an internal name — a file,
symbol, subcommand, or engine term — without saying what it means in
everyday words. If the reader would need to open a file to answer, the
question is not ready to ask.

**A label reads like a well-named variable.** Someone who skips straight to
the options knows what each one is from the label alone — nothing borrowed
from the paragraphs above it or from its place in the list. `needs-a-human`
passes; "Not true" and "the third one" do not. When the question is about
which action to take, name each option by what it does ("copy the file each
run", "keep the first copy"). When the question asks you to invent a name,
the drafted name itself is the label. An internal name never appears in a
label, even one explained earlier in the question — the label names what
the option does in everyday words (`checker-per-plan-file`, not
`fourth-lens`).

**Keep each part short.** Aim for 1–3 plain sentences per label. When a
question outgrows that, treat it as a sign it is really two questions —
split it.

**Durable question delivery.** A pending decision is the deliverable for that
turn. Put every complete four-part question block in the final response that
waits for the user's answer. Never put the full block in commentary and then
summarize or repeat only its Question in the final response; commentary may
report progress, but must not contain a decision the user needs to answer.

**One question per final response.** The engine raises one question at a time
and waits, so batching two into one message asks the user to answer something
the engine has not reached.

Never put a question to the user through an option-picker tool — the kind that
shows a list of one-line choices to select from. Every question in this phase
is written out in that final response, in the shape above. A picker's labels
cannot carry a Context, an Options list, or a drafted table, so what it saves in
typing it takes out of the user's ability to answer.

## What is already settled

**A settled decision is never re-asked, and you are not the one who decides
that.** The engine holds the settled claims, the confirmations behind them, and
the questions it has already had answered. It does not raise a question whose
answer is on the record, so a question that reaches you is one the record cannot
answer.

Three things follow from that.

**Brainstorm alignment is inherited, not re-interviewed.** When the work traces
to a `/brainstorm` that reached alignment, the product direction it settled — what
gets built, what it is worth, what is out — is already in the record, along with
the technical questions it explicitly delegated. Do not re-open any of it, and do
not interview the user about the product again. A technical finding that
contradicts a settled product decision is raised by the engine as a new question;
it is not yours to resolve quietly.

**The user's latest explicit instruction still outranks the record.** When what
they say now contradicts something settled, follow them — and say so plainly in
the answer you send back, so the record carries the supersession rather than two
answers with no order between them.

**On a ticket holding several plans, an earlier plan's records are context.**
Read them for what was built and why. A change to a plan whose implementation is
already finished belongs in **this** plan, never in an edit to that one.

## Steps

**1. Name the plan and open its tree.**

**With a ticket**, `<name>` is the plan's address — the ticket's branch, a slash
and the plan's id. Read what the ticket already holds first:

```sh
node "<plugin-root>/dist/cli.mjs" ticket show --name <ticket-branch>
```

Then continue the lowest-numbered plan still at `planning`, unless the user says
this is a separate plan — in which case add one:

```sh
node "<plugin-root>/dist/cli.mjs" ticket add-plan --name <ticket-branch> --slug <slug> [--title <title>]
```

and take the address it prints on its last line. What that command refuses, and
why, is the ticket-workflow skill's `### Adding a plan`. Two questions come
first, in the Question format: in single-plan mode with plan 001 already there,
whether to switch the ticket to multiple-plan mode; and on a ticket folder still
holding files from before ticket records, whether to run `lightsout ticket
adopt`. Declining the second is fine — planning then carries on in that folder as
it stands.

**With no ticket**, derive a kebab `<name>` from the request (e.g. "add a
rate-limit banner" → `rate-limit-banner`), and rename the folder to the ticket's
branch when the ticket is filed — see the ticket-workflow skill's `## Plan
folder` section for what a rename also has to update, and when it is too late to
do one. When the request is a rough-notes file path, read it before anything
else; when it already lives under the plans directory, take `<name>` from the
path segments below that directory instead of deriving a new one.

Once `<name>` is settled, establish the plan's own worktree as the very first
shell command:

```sh
node "<plugin-root>/dist/cli.mjs" plan workspace --name <name>
```

Read the absolute path it prints on its last line, and do every later step from
that directory. The plan folder already in this checkout is copied into the tree,
so anything a brainstorm left is there too; pass any rough-notes path as an
absolute one, since it lives in the checkout you started from. A nonzero exit is
the end of the session — report the sentence it printed and stop, never carry on
in the launching checkout. The command is safe to re-run: a session already
standing in the tree is answered the same path.

For a plan address, the tree is the ticket branch's, so a later plan of the
ticket continues in the tree its earlier plans used and is researched against the
implementation already on that branch. While a live implementation run holds that
tree, the command refuses and names the run: report its sentence and stop.

Surface any discrepancy between the ticket text and the user's current direction
per the ticket-workflow skill's `## Keeping the body true` — and never hold this
session up waiting on a ticket edit.

**2. Capture what the user actually asked for.**

Write one `PlanningInput` JSON file. It holds the user's **original wording**,
the claims made from it, and a confirmation per settled user claim carrying the
message where they said it. This is the one thing the engine cannot do for
itself, and everything downstream is answerable to it — so it is the user's
words, not your summary of them.

The shape is strict and every field is validated. Three rules decide whether it
is accepted at all:

- each `sources` entry carries the user's own text and the SHA-256 of exactly
  that text in `sha256`;
- a claim with `"owner": "user"` and `"state": "settled"` names the
  `confirmationId` of the confirmation that settles it — nothing else may settle
  a user claim;
- that confirmation's `approvedDigest` is the digest of the source the claim came
  from, and its `messageText` is what the user actually said.

Never invent a source, a confirmation or an approval the user did not give.
There is no plain-text answer route and no way to mint one.

A plan continuing from a brainstorm that reached alignment already has its
record; pass `--input-file` only for material that is genuinely new. A plan
folder of the older shape — `facts.json` and `decisions.json` — is still read,
and needs no input file at all.

**3. Run the planner, and answer what it asks.**

```sh
node "<plugin-root>/dist/cli.mjs" plan run --name <name> [--input-file <path>]
```

`--stage` defaults to `implementation` and `--mode` to `interactive`, which is
what this skill wants; pass them only to be explicit. The command investigates
the repository, settles the design, has it challenged by a reviewer that did not
choose it, drafts, has the draft challenged again, repairs and verifies each
finding, and reviews the whole — stopping at the first thing it cannot settle
itself. It prints one typed result and exits.

- **`awaiting-user`** — one question, carrying its own context, options and
  recommendation. Put it to the user in the Question format, **one at a time**,
  then send the answer back:

  ```sh
  node "<plugin-root>/dist/cli.mjs" plan answer --name <name> --answer-file <path>
  ```

  The answer file repeats the `questionId`, `checkpointRevision` and
  `questionDigest` the result printed, plus the option the user picked or the
  text they typed, plus a confirmation carrying their message. An answer naming a
  checkpoint the plan has moved past is refused rather than applied to the wrong
  question — re-run `plan run` and ask what it asks now.

  Relay the question as the engine wrote it. Do not soften it, do not answer it
  on the user's behalf, and do not batch two into one message. If the engine
  raises a question the user already answered, say so and answer it from what
  they said rather than making them repeat it.

- **`complete`** — readiness was derived from the records and persisted with the
  generation it certifies. Go to step 4.

- **`externally-blocked`** — report the `cause` it printed and stop. A missing
  original request and a harness that cannot provide the drafting environment
  both land here, and neither has a workaround worth trying.

Re-run `plan run` after each answer. Keep going until it prints `complete` or
`externally-blocked`. **The user saying "stop" is not an outcome** — it ends the
session with the plan unready, and the handoff below must not be printed for it.

**What `complete` means, exactly.** Every obligation the original request carried
is traced to something in the plan, every blocking finding is repaired and
verified by someone other than its repairer, and the whole plan has been read end
to end. It is planning readiness and nothing more: it is not implementation
verification, it does not start a build, and it is not authority to ship.

**What you must not do.** Do not edit the plan files by hand to settle a
question — the answer belongs in the record, and a hand edit is authority the
engine cannot see. Do not re-run anything to get a different answer. Do not
re-draft: the engine decides when authoring runs again, and asking for one
unconditionally throws away work that is still current.

**4. Handoff.** When the work traces to a ticket, take it to ready-to-implement
first, in this order:

```sh
node "<plugin-root>/dist/cli.mjs" plan publish --name <name>
node "<plugin-root>/dist/cli.mjs" ticket-state --ref <ticket> --planning-status planning-complete --tracker-status ready
```

Publish first, so the durable plan is on the ticket before anything claims the
ticket is ready to build. A successful publish is also what moves this plan from
`planning` to `ready` on the ticket's record. Between the two commands, drain the
ticket's `## Open questions` of every line the shaping answered. Then run
`ticket-state`. A nonzero exit from either command is a stop: report the exact
failure and do not print the handoff line below, because a ticket another machine
cannot recover is not ready for anyone. The rule behind the order is the
ticket-workflow skill's `### Publish when the ticket is ready to implement, not
at close` section.

A plan whose citations rest on evidence that cannot travel stays blocked at
publish rather than being published in a form that no longer proves what it
claims. Report what it says; there is nothing to work around.

On a multiple-plan ticket, add one line to the handoff: the ticket stays open
until the user files a ship request with `lightsout ticket request-ship`, and the
ticket-workflow skill's `### Ship requests` says what that request has to name.
Never file one yourself — the user decides the finish line.

With no ticket, skip both commands.

Then relay:

```
Next: run the `implement` skill with .lightsout/plans/<name>
```

The same line works for both shapes — the engine reads the folder: an
`overview.md` runs every phase in order, otherwise the folder's `plan.md` runs on
its own. To run a single phase of a phased plan by itself, pass that phase file
instead, with `overview.md` as its overview.

The implementation run does not re-plan. It freezes the completed planning
generation and its ordered phases, and a fresh agent is handed the plan text plus
the contract behind it: the original claims, the repository's standards, the
exact acceptance obligations, the roots it may touch, and its bounded freedom
over private helpers. Everything public is the plan's decision; the internal
structure is the implementer's, within the standards. That freeze is planning
authority alone — it is not a snapshot of the repository's source, and it replays
no earlier verification.

## Diagnostics

`lightsout status --planning <name>` shows what the records hold: the work items
and their states, the blocking findings still open, the saved conclusions
available for reuse, the findings repaired and verified, what the recorded
provider calls cost, and the outcome of the implement run this repository holds
for the plan.

Read it as it is written. Detail the records do not hold is shown as
unavailable, and relaying it as a zero, a pass or a saving is a claim the records
do not support. Planning cost is never an implementation outcome.
