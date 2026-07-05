---
name: plan
description: Produce a rigorous, implementation-ready plan for a feature — one a fresh-context agent can implement without guessing. Explores the codebase, interviews you to drain what you know, drafts the plan, grills it for edge cases, and grades it to A. Use when the user wants to plan a feature, write an implementation plan, or get a plan graded before implementing. Input is a feature description or a rough-notes file path. Output feeds `/implement`.
allowed-tools: Bash, Read, Write, Edit
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

## Steps

**0. Name the plan.** Derive a kebab `<name>` from the request (e.g. "add a
rate-limit banner" → `rate-limit-banner`).

**1. Explore.** Run:
```sh
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" plan explore "<request>" --name <name>
```
Add `--areas a,b,c` (one explorer per area) for a feature spanning multiple
packages/layers. Relay the verification summary; note any missing paths for
Elicitation.

**2. Elicitation** — drain the user's *conscious* knowledge (interactive):
- Batch related questions, ≤4 per turn, **recommended answer first**, resolve the
  decision tree branch by branch, reflect each answer back to converge on a
  shared understanding. Never ask what the codebase can answer — read it (or
  re-run `plan explore`) instead.
- Continue until the user is **tapped out and aligned** — their bound, not yours.
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

**3. Draft.** Run:
```sh
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" plan draft --name <name>
```
Pass `--scope single|phased` only to override the engine's estimate. On
`facts error` → re-run `plan explore` with corrected scope, then re-draft. On
remaining `structural issue(s)` → relay them. On success → note the written
`plan.md` path.

**4. Grill** — push past conscious knowledge against the *drafted* plan
(interactive, unbounded):
- Relentless, **one question at a time**, recommended answer first; explore the
  codebase instead of asking whenever possible.
- After each answer, **immediately fold it into `plan.md` via Edit** and append a
  `Decision Log` row with `Source = Grill`. Do not batch edits to the end.
- Continue until **the user says stop** — do not self-terminate.

**5. Dedup Review** — resolve prior-art duplication (interactive). This is the
last shaping of the plan; after it the plan is complete and Grade only verifies.
Run:
```sh
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" plan dedup --name <name>
```
Read `.lightsout/plans/<name>/dedup.json`. Detection and judgment are the
subcommand's; you only conduct the review and apply the chosen edits.
- `findings` empty → nothing to review; go to Grade.
- `findings` present → for each finding show its `plannedSymbol`, `collidesWith`,
  the judge's `recommendation`, and the resolution menu; get the user's choice
  per finding **or** offer **auto-accept** (apply every `recommendation`, showing
  a summary first). Apply each chosen resolution to `plan.md` via Edit:
  - **reuse** → drop the Files-to-Create entry; wire the plan's usage to the
    existing symbol.
  - **extend** → add a Files-to-Modify entry for the existing symbol.
  - **extract** → add the shared file to Files-to-Create at `suggestedLocation`,
    plus a Files-to-Modify entry per `migrateCallers`.
  - **defer** → leave the entry; record the accepted duplication in `## Prior Art`
    (logged debt).
  - **distinct** → record the justification in `## Prior Art`.
  Append a `Decision Log` row `Source = Dedup` for each resolution.

**6. Grade + converge.** Run:
```sh
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" plan grade --name <name>
```
Read `.lightsout/plans/<name>/grade.json`:
- `"passed": true` → go to handoff.
- `"passed": false` with `gaps` → surface them (batched, recommended-first).
  Resolve each by **editing `plan.md` in place via Edit** (+ a `Decision Log` row,
  `Source = Converge`; mirror the resolution into `decisions.json`). Then re-run
  `plan grade`. Repeat until `passed` or the user calls it. **Do NOT re-run
  `plan draft`** — a re-draft regenerates `plan.md` and would clobber the Grill
  edits already folded in.
- `structural` findings present (rare) → apply each finding's exact `fix` to
  `plan.md` via Edit, then re-grade.

**7. Handoff.** Relay the final grade and:
```
Next: /implement --plan <plansDir>/<name>.md
```
(or the phased equivalent). List any decisions left unresolved. The grade is
advisory — `/implement` runs whatever plan it is given.
