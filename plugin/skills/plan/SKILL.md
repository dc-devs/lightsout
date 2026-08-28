---
name: plan
description: Produce a rigorous, implementation-ready plan for a feature — one a fresh-context agent can implement without guessing. Explores the codebase, interviews you to drain what you know, drafts the plan, grills it for edge cases, and grades it to A. Use when the user wants to plan a feature, write an implementation plan, or get a plan graded before implementing. Input is a feature description or a rough-notes file path. Output feeds `/implement`.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Task
---

# lightsout: plan

**This skill is the interactive conductor, not the engine.** All determinism —
fact verification, the draft↔structural-lint loop, grading — lives in the
`lightsout plan …` subcommands as deterministic code. This skill only conducts
the human dialogue the engine cannot (Elicitation, Grill, gap resolution) and
relays typed results. **Do not add gates, retries, caps, or contract parsing
here.** The one branch you make is reading the typed `passed` verdict from
`grade.json`.

Resolve the engine bundle once: `${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs`. If it does
not exist, stop and tell the user to reinstall the plugin or run `pnpm bundle`.

## Question format

Every question this skill puts to the user — Elicitation batches, Grill
escalations, Dedup findings, Converge gaps — uses this labeled four-part
shape, in this order:

**Context:** what the question is about and why it matters, in everyday
words. Write for someone who has not read the plan or the code — never
assume they know the plan's internals. State the problem the question
decides — in everyday words — before naming any options.

**Trade-offs:** what each answer wins and what it costs, plainly. When an
option carries risk, say what goes wrong if it fails and what catches it.

**Question:** the question itself, one sentence.

**Recommendation:** the answer you recommend and the one-line why, so a
one-word reply ("yes", "the second one") resolves it.

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

**Option labels are everyday words.** Name each option by what it does
("copy the file each run", "keep the first copy") — never invented
shorthand, codenames, or bare letter labels the reader must decode.

**Keep each part short.** Aim for 1–3 plain sentences per label. When a
question outgrows that, treat it as a sign it is really two questions —
split it.

**At most 2 full-format questions per message.** Truly trivial yes/no items
may share one combined block instead of getting a block each. Grill
escalations are stricter: one question at a time, always.

**The format applies regardless of medium.** When asking through an
option-picker tool, the Context, Trade-offs, and Recommendation go in the
question body — never squeezed into option labels.

## Steps

**0. Name the plan.** Derive a kebab `<name>` from the request (e.g. "add a
rate-limit banner" → `rate-limit-banner`). When the request is a rough-notes
file path (given by the user, or a `/brainstorm` handoff), read it before
anything else; when it already lives at `.lightsout/plans/<name>/notes.md`,
take `<name>` from its folder instead of deriving a new one. Also read
`.lightsout/plans/<name>/brainstorm-decisions.json` when it exists — its rows
are decisions already settled with the user. Absent → nothing changes; that is
the normal path for a plan that started from a direct request.

**1. Explore (in-context) + verify.** Explore the codebase yourself: read the
files the request touches, follow the integration points, and note real
signatures. For a feature spanning many packages/layers, optionally fan out
read-only Explore subagents for breadth — either way YOU author the facts, and
only from paths you actually confirmed by reading them. Author
`.lightsout/plans/<name>/facts.json`. Write this **exact** shape (the engine
hard-parses it):
```json
{
  "request": "<the feature request>",
  "areas": [
    {
      "area": "<what this area covers>",
      "affectedPackages": ["<repo-relative package dir>"],
      "filesToModify": [{ "path": "<repo-relative>", "role": "<one line>" }],
      "patternsToMirror": [{ "path": "<repo-relative>", "takeaway": "<what to take>" }],
      "integrationPoints": [{ "name": "<symbol>", "signature": "<real signature>", "at": "<file:line>" }],
      "scripts": [{ "key": "<package.json script key>", "command": "<what it runs>" }],
      "namingConvention": "<one line>"
    }
  ]
}
```
Then run:
```sh
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" plan verify-facts --name <name> [--notes "<path>"]
```
Pass `--notes` when the request came from a rough-notes file — the engine
freezes a copy at `.lightsout/plans/<name>/notes.md` as the plan's first
artifact. Write-once: an existing snapshot is never overwritten, so re-running
verify-facts never clobbers it (a `/brainstorm`-authored notes.md is already
home and is simply kept).
It deterministically checks every claimed path/script on disk and stamps the
verification into facts.json. Relay the summary; fix any genuinely wrong path
in facts.json and re-run verify-facts, and carry remaining missing-path
warnings into Elicitation.
- While exploring, deliberately check each settled brainstorm decision against
  the code you are reading. The value of the hand-off is that the plan trusts
  these rows without asking, and trust that is never verified is a guess. Note
  any conflict with the exact `file:line`.

**2. Elicitation** — drain the user's *conscious* knowledge (interactive):
- **Scope check first.** Before any detail question, judge the request's
  size: one plan, one phased plan, or several independent plans. When it is a
  genuine fork, ask in the Question format; when the request is several
  independent plans, say so, agree which to plan now, and record the split as
  a decisions row. This check aims the interview — the engine's `plan draft`
  still makes the single-versus-phased estimate on its own.
- **Collect global constraints.** Ask once, early, whether any project-wide
  rules bind this work (for example "no new dependencies", "the public API
  stays frozen"). Record each as its own decisions row whose `question`
  begins exactly `Global constraint:` — the drafted plan's Global
  Constraints section is built from these rows. None stated → no rows; the
  section will read "None". Constraints already recorded as brainstorm rows
  carry their own `Global constraint:` prefix and flow through untouched —
  ask only for rules not already settled.
- **Harvest the session first.** If the feature was discussed in this
  conversation before the skill was invoked, record each decision the user
  already made as a decisions row (`Source = "Elicitation"`) before asking
  anything. Settled in-session means settled — never re-ask it.
- **Honor the brainstorm hand-off.** The rows in
  `brainstorm-decisions.json` are decisions already settled with the user:
  - Settled in brainstorm means settled — never re-ask it.
  - Re-open a row only for a contradiction you can name in a specific file
    and line. A preference for a different approach is not a contradiction.
  - A re-opened row is asked in the Question format, with the contradicting
    `file:line` stated in the Context. Record the corrected answer as a
    **new** row in `decisions.json` with `source: "Elicitation"`,
    **repeating the brainstorm row's `question` text verbatim**, and a
    rationale naming the `file:line` and saying it supersedes the brainstorm
    row. The repeated question text is what marks the supersession: the plan
    writer treats the last row sharing a question as the live one, so the
    corrected answer wins while both rows stay in the Decision Log. This
    matters most for `Global constraint:` rows, where the live row alone
    becomes a binding bullet. Never edit `brainstorm-decisions.json` —
    brainstorm owns it, and both rows belong in the log.
  - Do not copy brainstorm rows into `decisions.json`; `plan draft` reads
    both files and merges them.
- Ask in the Question format above — at most 2 full-format questions per
  message. Resolve the decision tree branch by branch, reflect each answer
  back to converge on a shared understanding. Never ask what the codebase can
  answer — read it (or re-explore in-context, update facts.json, and re-run
  `plan verify-facts`) instead.
- Continue until the user is **tapped out and aligned** — their bound, not yours.
- **Alignment checkpoint.** Close by stating back, in plain words: the goal,
  the design shape, and the kinds of implementation detail you will decide
  yourself from here (best practice only). The user's explicit confirmation
  licenses Grill's self-answer routing (step 5); without it, every grill
  question escalates to the user. A brainstorm hand-off does not stand in for
  this checkpoint: the plan reads the code after brainstorm ended and may
  surface things brainstorm could not have known, so the licence to
  self-answer is still earned here.
- Author `.lightsout/plans/<name>/decisions.json`. Write this **exact** shape
  (the engine hard-parses it; a wrong field name blocks drafting):
  ```json
  {
    "planName": "<name>",
    "decisions": [
      { "source": "Elicitation", "question": "<q>", "options": "<A / B>",
        "choice": "<chosen>", "rationale": "<one line>", "assumption": false }
    ]
  }
  ```
  `source` is exactly `"Elicitation"` | `"Grill"` | `"Dedup"` | `"Converge"`;
  `options` is a string; `assumption` is a bool. Mark a choice made without user
  confirmation as an assumption.

**3. Approaches** — settle the design shape before drafting (interactive,
conditional). Run this step when the design shape is not already settled by
the session discussion, the Elicitation answers, or a brainstorm decision
naming the chosen approach. When it is settled, say so in one line ("Design
shape settled during Elicitation — skipping approaches", or "Approach settled
during brainstorm — skipping approaches") and move on — never skip silently. Present 2–3 genuinely different approaches
in the Question format: Context states the design problem in everyday words,
Trade-offs gives each approach's wins and costs, Question asks which to build,
Recommendation names one with the one-line why. Record the chosen approach as
a decisions row (`Source = "Elicitation"`) before drafting.

**4. Draft.** Run:
```sh
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" plan draft --name <name>
```
Pass `--scope single|phased` only to override the engine's estimate. On
`facts error` → re-explore in-context, correct facts.json, re-run
`plan verify-facts`, then re-draft. On
remaining `structural issue(s)` → relay them. On success → note the written
`plan.md` path.

A phased draft runs in two stages: one agent authors `overview.md`, the engine
checks the phase breakdown it declares against the created-file ceiling, and
then one agent per declared phase authors its `phase<N>-<slug>.md`
concurrently. So `structural issue(s)` on a phased plan may name the overview's
**phase breakdown** rather than a phase file: a phase that creates more files
than one implementing agent may. The fix there is to resplit the phases — edit
the overview's `## Phases` table and its `## Phase Declarations` to spread the
creates across more phases — and re-run `plan draft`.

**5. Grill** — push past conscious knowledge against the *drafted* plan
(interactive, unbounded):
- Relentless: generate the full stream of edge-case questions against the
  draft — grilling intensity never drops. Routing decides who *answers* each
  question, never whether it gets asked. Explore the codebase instead of
  asking whenever possible.
- **Route every question before surfacing it. Escalating to the user is the
  default** — self-answer is the single exception, allowed only when ALL of
  these hold: the user confirmed the alignment checkpoint (step 2); the answer
  follows directly from the established goal, direction, and architecture; and
  no defensible reading of the user's intent gives a different answer. Fail
  any one → escalate. (Typical escalations: a genuine fork, anything that
  could bend the plan's direction, a question with two defensible answers —
  illustrative, never a filter.) **When in doubt, escalate.**
- **Self-answered** → fold the answer into `plan.md` via Edit, append a
  `Decision Log` row with `Source = Grill` and a rationale ending in
  `(self-answered)`, and mirror it into `decisions.json` with
  `"assumption": true`. Do not surface it live.
- **Escalated** → **one question at a time**, in the Question format (one
  full labeled block per message — never two). After each answer,
  **immediately fold it into `plan.md` via Edit** and append a
  `Decision Log` row with `Source = Grill`. Do not batch edits to the end.
- Continue until **the user says stop** — do not self-terminate. Self-answering
  a question never counts as stopping.
- **Assumption digest.** When the user stops, list every self-answered
  question with its chosen answer. A veto re-opens that question as an
  escalation — fold the corrected answer into `plan.md` before moving on.

**6. Dedup Review** — resolve prior-art duplication (interactive). This is the
last shaping of the plan; after it the plan is complete and Grade only verifies.
Run:
```sh
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" plan dedup --name <name>
```
Read `.lightsout/plans/<name>/dedup.json`. Detection and judgment are the
subcommand's; you only conduct the review and apply the chosen edits.
- `findings` empty → nothing to review; go to Grade.
- `findings` present → surface each finding in the Question format (at most
  2 per message): **Context** says in plain words what the plan wants to
  build and what already exists that overlaps — never bare symbol names;
  **Trade-offs** summarizes the resolution options; **Question** asks which
  to pick; **Recommendation** is the judge's `recommendation` in plain
  words. Get the user's choice per finding **or** offer **auto-accept**
  (apply every `recommendation`, showing a summary first). Apply each chosen
  resolution to `plan.md` via Edit:
  - **reuse** → drop the Files-to-Create entry; wire the plan's usage to the
    existing symbol.
  - **extend** → add a Files-to-Modify entry for the existing symbol.
  - **extract** → add the shared file to Files-to-Create at `suggestedLocation`,
    plus a Files-to-Modify entry per `migrateCallers`.
  - **defer** → leave the entry; record the accepted duplication in `## Prior Art`
    (logged debt).
  - **distinct** → record the justification in `## Prior Art`.
  Append a `Decision Log` row `Source = Dedup` for each resolution.
- Each finding carries the `phase` it was planned in — the plan file's
  basename. Apply the resolution to **that** file, not to `plan.md`.
- `"complete": false` means a judge failed or hit the rate-limit wall. The
  findings present are real, but the scan is partial — resolve them, then
  re-run `plan dedup` before moving on.

**7. Grade + converge.** Run:
```sh
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" plan grade --name <name>
```
Read `.lightsout/plans/<name>/grade.json`:
- `"passed": true` **and** `"complete": true` → go to handoff.
- `"passed": false` with `gaps` → surface **only the blocking gaps**: the ones
  whose `outcome` is `needs-a-human` or `unjudged`. Put each in the Question
  format (at most 2 per message, recommended-first), **grouped by the gap's
  `phase`**. Resolve each by **editing the plan file its `phase` names** in place
  via Edit — `plan.md` for a single plan, that `phase<N>-<slug>.md` for a phased
  one (+ a `Decision Log` row, `Source = Converge`; mirror the resolution into
  `decisions.json`). Then re-run `plan grade`. Repeat until `passed` or the user
  calls it. **Do NOT re-run `plan draft`** — a re-draft regenerates the plan
  files and would clobber the Grill edits already folded in.
- Everything else the pass found is still in `grade.json`, in full, for the user
  or a later agent to read. Nothing was dropped; it was weighed and found not to
  need them.
- Every gap carries an `outcome` saying who has to settle it:
  - `needs-a-human` — a person has to decide this one. These are the questions.
  - `agent-can-decide` — the implementing agent can settle it on its own, and
    `agentDecision` says what it would decide. Not a question.
  - `already-answered` — the answer is already in the plan or the code, and
    `answerAt` says where. Not a question.
  - `unjudged` — nobody weighed this one, so it blocks until someone does.
- **An `unjudged` gap is a different question from a `needs-a-human` one, and
  must not be dressed as the same thing.** Surface it in the Question format like
  any other blocking gap, so it is never silently dropped — and in the same
  block, say plainly that it blocks because nobody weighed it, not because the
  plan is thin, and quote its `unjudgedReason`. Say that re-grading will **not**
  retry that judge: a re-grade re-runs every reader and comes back with a fresh
  set of findings, so this exact one may simply not reappear, and there is no way
  to re-judge a single finding. Leave the choice with the user: answer it into
  the plan, or let it go. Do **not** recommend a re-grade as the remedy — it
  reads like a retry and is not one.
- Every gap also carries the `lens` that found it (`surface`, `wiring`,
  `decisions`) — three differently-briefed checkers read every phase, so two
  gaps with the same text and different lenses are two lenses agreeing, not
  noise.
- While resolving, re-check a single phase you just edited with
  `lightsout plan grade --name <name> --phase <n>` — three checkers and about
  three minutes instead of a full pass. The final grade before handoff is
  **always** a full run with no `--phase`.
- **A grade whose `"complete"` is false, or whose `phasesChecked` does not list
  every phase file in the plan folder, is not a clean bill whatever its
  verdict.** Its gaps are real and worth fixing, but the unlisted phases were
  not looked at — say so to the user and re-grade once the fixes are in.
  (`overview.md` is deliberately never gap-checked and never appears in
  `phasesChecked`; it is checked deterministically instead.)
- `structural` findings present (rare) → apply each finding's exact `fix` to
  the plan file named by its `phase`, via Edit, then re-grade. A finding
  printed as `note` rather than `⚠` is **advisory**: information for you and
  the user, not work to do.
- Reading a typed field to decide what to display is not a gate. What blocks is
  decided in the engine and arrives as `passed`; you never recompute it.

**8. Handoff.** Relay the final grade and:
```
Next: /implement --plan .lightsout/plans/<name>
```
The same line works for both shapes — the engine reads the folder: an
`overview.md` runs every phase in order, otherwise the folder's `plan.md` runs
on its own. To run a single phase of a phased plan by itself, pass that phase
file instead: `/implement --plan .lightsout/plans/<name>/phase1-<slug>.md --overview .lightsout/plans/<name>/overview.md`.

List any decisions left unresolved. The grade is
advisory — `/implement` runs whatever plan it is given.
