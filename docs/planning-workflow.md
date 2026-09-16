# The planning workflow

How a request becomes a plan a fresh agent can build, who decides what along the
way, and what the records can and cannot tell you afterwards.

Two entry points sit on the same engine. `/brainstorm` settles the **product**:
what gets built, what it is worth, what is explicitly out. `/plan` — and
`/auto-plan`, which is the same planner answering its own questions — settles
the **implementation**: the design, the files, the exact acceptance obligation
for each thing that has to be true. Neither is a script of steps. The engine
reads its own records and decides what to do next, which is why a plan that has
already established something does not establish it again.

## The default flow

1. **Your request is recorded as you wrote it.** The original wording, where
   each line came from, and your own approving messages. Nothing plans from a
   summary of your request.
2. **The repository is investigated.** Named investigations read the files the
   request touches and record what they read. What could not be established is
   recorded as an unknown rather than guessed.
3. **A design is proposed and independently challenged.** Someone other than
   the author reads it against your original request and names concrete failure
   scenarios. Drafting waits until those are answered.
4. **The plan is written**, then challenged again against the same original
   request.
5. **Every finding is repaired and verified by someone other than its
   repairer**, and one last reviewer reads the finished plan end to end.
6. **Readiness is derived**, never declared. An obligation your request carried
   that the plan does not cover keeps the plan unready, however well the rest
   of it reads.

Along the way you are asked only the questions that are genuinely yours.

## What the engine owns, and what a model owns

The engine owns the loop, the records and every verdict. It decides which role
runs next from what the records hold, it accepts or rejects what a role hands
back against the schemas, and it derives readiness. A model is asked to
investigate, to design, to review, to draft and to repair — and nothing a model
says is taken as a state change until the engine has validated it and committed
it.

That split is what these seven properties rest on.

**E1 — unresolved work is the engine's, and readiness is derived.** There is no
step counter and no fixed run of subcommands. Work items live in the record with
their own roles and prerequisites, and a plan is ready when nothing is left
open, not when a sequence has finished.

**E2 — investigations are named, and what they found is shared.** A conclusion
is recorded once and read by the next role instead of being re-derived. An
unknown stays unknown: it is recorded as one, and it is never quietly closed
because a later role needed an answer.

**E3 — the context handed to a role is scoped, and keeps the original intent.**
A role gets enough to do its job, including your original wording and the
standards the repository binds itself to — not a paraphrase of either.

**E4 — the design is challenged before drafting, and the draft is challenged
after.** Both challenges are deliberate and independent, and a post-draft
finding has to name a concrete scenario rather than a style preference.

**E5 — adjudication is for genuine disputes only.** A finding with a clear
answer is repaired directly. Only a real disagreement between two reports gets
adjudicated, and the adjudication is on the record.

**E6 — reuse follows the dependency graph, and the whole is reviewed last.**
Saved work is reused when its inputs have not moved; when something is
uncertain, review widens rather than narrows. A final independent integration
review reads the finished plan as one thing, because a plan can be locally
repaired everywhere and coherent nowhere.

**E7 — cost and rework are reported honestly.** What was recorded is shown; what
was not recorded is shown as unavailable. See
[Diagnostics](#diagnostics-and-their-limits).

There is no fixed three-reader ritual, no file-count exemption from review, no
hard planning budget, no cap on repairs, no promised saving and no benchmark.

## Running it

`lightsout plan run` carries planning forward until it reaches a real
checkpoint, then prints one typed result and exits. `lightsout plan answer` is
how a decision comes back.

```sh
lightsout plan run --name lo-64-rate-limit/001-public-api \
  --stage implementation --mode interactive --input-file .lightsout/input.json
```

`--stage` is `brainstorm` or `implementation`, defaulting to `implementation`.
`--mode` is `interactive` or `automatic`, defaulting to `interactive`.

`--input-file` is optional and holds one strict `PlanningInput`: your original
sources with their digests, the claims made from them, and the confirmations
carrying your own approving messages. A source whose `sha256` is not the digest
of its own `text` is rejected before any agent is spawned, and so is a settled
user claim with no confirmation behind it.

```json
{
  "stage": "implementation",
  "sources": [
    {
      "artifact": "LO-64.md",
      "locator": "Requirement",
      "text": "Completed uploads are preserved when a retry fails.",
      "sha256": "e043edf5c7d6e14ba0e715747191b7bcbb76b44930a632ea92a56826bb20c39d"
    }
  ],
  "claims": [
    {
      "id": "preserve-uploads",
      "kind": "requirement",
      "text": "Completed uploads are preserved when a retry fails.",
      "explanation": "",
      "contentRevision": 1,
      "origin": {
        "artifact": "LO-64.md",
        "locator": "Requirement",
        "text": "Completed uploads are preserved when a retry fails.",
        "sha256": "e043edf5c7d6e14ba0e715747191b7bcbb76b44930a632ea92a56826bb20c39d"
      },
      "owner": "user",
      "state": "settled",
      "dependencies": [],
      "scope": { "kind": "whole-plan", "claimIds": [], "phaseIds": [], "packageRoots": [] },
      "confirmationId": "approval-1"
    }
  ],
  "confirmations": [
    {
      "id": "approval-1",
      "channel": "foreground",
      "messageId": "msg-1",
      "messageText": "Completed uploads are preserved when a retry fails.",
      "approvedDigest": "e043edf5c7d6e14ba0e715747191b7bcbb76b44930a632ea92a56826bb20c39d",
      "delegation": { "kind": "whole-plan", "claimIds": [], "phaseIds": [], "packageRoots": [] }
    }
  ]
}
```

### The four results

The printed result is one of four, and the exit code follows it.

| Status | Exit | What it means |
|---|---|---|
| `complete` | 0 | Implementation readiness is derived and certified for this generation. It is not permission to build, and it starts nothing. |
| `aligned` | 0 | A brainstorm reached confirmed alignment. Technical planning inherits it. |
| `awaiting-user` | 2 | One question is waiting. Nothing moves until it is answered. |
| `externally-blocked` | 1 | Something outside planning is in the way — a missing original request, a capability the harness cannot provide. |

### Answering

An `awaiting-user` result carries the question in full and the identity of the
checkpoint it is asked at. An answer names that identity back, so an answer
written against a question the plan has moved past is refused rather than
applied to the wrong one.

```sh
lightsout plan answer --name lo-64-rate-limit/001-public-api \
  --answer-file .lightsout/answer.json
```

```json
{
  "questionId": "claim:retention-question",
  "checkpointRevision": 7,
  "questionDigest": "…the digest the run printed…",
  "selectedOption": "Retain uploads",
  "confirmation": {
    "id": "approval-2",
    "channel": "foreground",
    "messageId": "msg-2",
    "messageText": "Retain the completed uploads.",
    "approvedDigest": "737fb27d07d9152322d44f9580692aeff65c16305ab379d9130eea69fe685ef7",
    "delegation": { "kind": "whole-plan", "claimIds": [], "phaseIds": [], "packageRoots": [] }
  }
}
```

There is no plain-text answer interface: an answer carries either the option it
picked or the text you typed, and always the confirmation that says a person
actually said it. A model cannot mint one.

### What a question looks like

Every question the engine raises carries four parts, so it can be answered
without opening a file:

- **context** — what the question is about and why it matters, in everyday words;
- **question** — the question itself;
- **options** — each with a name and what it wins and costs;
- **recommendation** — one of them, named.

A question is raised only when the answer is genuinely yours: a name you will
read, a behaviour you will see, a cost you will pay, a public contract, a scope
call. Best-practice questions — where a helper goes, which pattern to mirror,
what to call a private function — are not yours to answer and are not asked.

## Who owns an approval

A confirmation approves the thing it was shown and nothing else.

The `auto-plan` config block decides which checkpoints stand: whether a proposal
comes before drafting, whether an approved proposal starts the build, and
whether the proposal is skipped when nothing cleared the bar. Those settings are
about **checkpoints**, not about product authority. Turning
`auto-approve-plan` on does not pre-approve a product decision the planner has
not made yet — a genuinely new one still stops the run with its own question.

Brainstorm alignment works the same way. It settles the product direction and
says in writing which technical questions it is delegating. Technical planning
inherits that and does not re-interview you about it — but a technical finding
that contradicts a settled product decision is raised as a new question rather
than resolved quietly.

## Recovery, resume and handoffs

These are three different things and they are easy to confuse.

**Planning response recovery** is within planning. When a planning role was
invoked and the run died before its answer was accepted, the recorded response
is recovered rather than paid for a second time. This applies to planning roles
only.

**Implementation resume** is a different mechanism, in the implement pipeline. A
resumed run keeps the partial files already written, the writing steps already
completed and the approved-test baselines the run took, and then re-runs the
ordinary verification and formatting. It does **not** replay the verification
results a previous attempt recorded, and it does **not** recover an
implementation provider's paid response — a re-invoked implementation step is
invoked again.

**The handoff** is what ties a run to a plan. An implementation run's manifest
retains the completed planning generation it was started from and the ordered
phases of that generation. What this freezes is planning authority — the plan
text, the claims, the standards, the acceptance obligations — and it freezes
nothing else. It is **not** a snapshot of the repository's source, and nothing
in it lets a run reconstruct the code as it stood.

Because the handoff is bound to one generation, a run cannot silently pick up a
newer plan, and a resume cannot swap its handoff for another. A run started
before handoffs existed keeps working and simply has none.

The fresh implementation input a handoff produces is the frozen plan text plus
the contract behind it: the original claims, the standards the repository binds
itself to, the exact acceptance obligations, the roots the work may touch, and a
statement of the freedom the implementer has over private helpers. That last
part is deliberate — the implementer chooses its own internal structure within
the standards, and everything public is the plan's decision, not its own.

## Publication and restore

A planning generation can be exported as one portable document and installed
elsewhere, which is what puts a plan on a ticket and gets it back on another
machine.

Publication cannot drop bytes a retained citation depends on. If a plan rests on
evidence whose authority cannot travel, the plan stays blocked rather than being
published in a form that no longer proves what it claims. That is a real limit,
not a bug: a restored generation that could not answer for its own citations
would be a plan nobody can check.

A restored generation replays the calls it was exported with, so the same
provider call can appear twice in the local records. The diagnostics
deduplicate by call id for exactly that reason.

Artifacts that predate the canonical store still read. A plan folder whose
record is `facts.json` and `decisions.json` drafts through the same engine, and
an authored Markdown plan is still a supported implementation input.

## Standards and capability blockers

Planning resolves the repository's own standards and commits them into the
record, so a role reads the standards the repository actually binds itself to,
and the acceptance a plan hands forward is stated against them.

Some harnesses cannot provide the restricted environment a plan writer is
spawned into — no MCP servers, no skill catalogue, a named tool allowlist, and
none of that altering the configured authentication, model, effort or
permissions. When the resolved harness cannot express one of those, the run is
refused before an agent is spawned, naming every control it lacks. Nothing is
substituted on your behalf: there is no second authoring implementation and no
quiet downgrade. Configure a harness that can provide them, under `harness` or
`commands.plan` in `lightsout.config.json`.

## Diagnostics and their limits

`lightsout status --planning <name>` draws what the records hold: the work items
and their states, the blocking findings still open, the saved conclusions
available for reuse, the findings repaired and verified, what the recorded
provider calls cost, and the outcome of the implement run this repository holds
for the plan.

What it will not do is fill a gap in.

- A provider call whose harness reported no usage is counted and named as
  unreported. It is never summed as zero, and a plan whose calls all reported
  nothing shows no figure at all.
- A plan with no recorded call shows no cost, not a free one.
- Planning cost says nothing about implementation. The implementation line reads
  the run's own manifest, and says so plainly when there is no run to read.
- Older records and restored generations can be missing detail the newer ones
  hold. That is displayed as unavailable rather than backfilled.

Live savings are unmeasured. These diagnostics exist so that a later evaluation
has something honest to read, not to support a percentage.
