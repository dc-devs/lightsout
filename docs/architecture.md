# lightsout — Architecture

> Lights-out manufacturing: a factory that runs so reliably you turn the lights
> off and go home. This engine is what software pipelines need before anyone
> can leave the room.

## Thesis

Coding agents don't need help being smart — frontier models write good code on
the median run. They need to be **accountable on the bad run**, because
unattended systems require evidence, not claims. An agent can assert "tests
pass"; a subprocess that runs the tests and reads the exit code cannot be
sweet-talked.

Design rule that follows: **scaffolding that constrains the model depreciates
with every model release; scaffolding that verifies the model appreciates.**
Every component here must justify itself as verification, state, or transport —
never as "instructions to make the model code better." If a piece exists to
make the model smarter, cut it.

## Lineage

v1 of this system was a prose-orchestrated pipeline: control flow (gates, retry
caps, report parsing) written in markdown skills and *executed by an LLM* —
deterministic logic on a probabilistic interpreter. It worked, and it exposed
the structural limits: the conductor can miscount retries, skip gates under
context pressure, and mis-parse reports; pipeline state lives in a context
window that compacts. lightsout keeps v1's proven shape (specialized agents,
verification between steps, pluggable standards) and replaces the substrate.

## System

```
┌─ cli ────────────────────────────────────────────┐
│ run | resume | status                            │
├─ engine (deterministic — no model calls) ────────┤
│ pipeline steps · gates (if-statements)           │
│ budgets (counters) · run manifest (disk)         │
├─ agents ──────────────┬─ supervisor ─────────────┤
│ prompt (md) +         │ exception path only:     │
│ output contract (zod) │ retry|replan|split|      │
│                       │ escalate                 │
├─ drivers (the harness boundary) ─────────────────┤
│ claude-code (headless claude -p) · codex · [api] │
└──────────────────────────────────────────────────┘
```

| Package | Responsibility |
|---|---|
| `contracts` | zod schemas: run manifest, per-role agent reports, config. Validated at every boundary — invalid output is rejected and retried, never mis-parsed. |
| `engine` | The spine. Steps, gates, budgets, state, resume. Deterministic: gates are `if` statements, budgets are counters, verification is a subprocess exit code. |
| `agents` | Roles = markdown prompt + typed output contract. v0 roles: feature-executor, unit-test-writer, refactor-executor. Prompts are written fresh for the typed interface (not ports of v1). |
| `supervisor` (lives in engine for v0) | The one place non-determinism is *added*: invoked only on gate failure with (manifest, error output, attempt history); returns a structured verdict — retry-with-context / replan / split-scope / escalate-to-human. |
| `drivers` | Spawns the user's own installed harness. See billing rule below. |
| `cli` | `run`, `resume`, `status`. Bundled to `dist/cli.mjs`. |

## Non-negotiable rules

1. **The engine never handles model credentials.** Drivers spawn the user's
   own logged-in harness (`claude -p`, `codex exec`). This is simultaneously:
   the harness-agnostic story, the subscription-billing story (headless
   `claude -p` rides the user's Max plan; the Agent SDK is API-key-only and
   explicitly blocked from subscription auth — verified against official docs,
   2026-07), and what keeps the project clear of the third-party-auth policy.
2. **The plugin skill is a doorbell.** No gates, retries, or state in markdown,
   ever. The moment logic leaks into the wrapper, there are two orchestrators
   again.
3. **State lives on disk** (`.lightsout/runs/<id>/manifest.json` in the target
   repo), never in a context window. Crash → `resume` restarts at the failed
   step.
4. **Rate-limit exhaustion is a pausable state, not an error.** On Max-plan
   billing the binding constraint is the 5-hour/weekly window, not dollars.
   Runs park as `paused-rate-limit` and resume when the window resets.
5. **Typed contracts at every agent boundary.** No prose parsing. A malformed
   report is a validation failure with a retry, not silent corruption.
6. **Born generic.** The engine never references any consumer by name. A
   consumer integrates by adding `lightsout.config.json` (standards docs/lint
   preset, script commands, driver choice, budgets) to its own repo.

## The standards layer

Consumer coding standards enter as config, in two forms:

- **Style card** (short prose, loaded into agent prompts): judgment rules and
  creation-time decisions — architecture placement, casing identity rules,
  cascade-expensive conventions (one-export-per-file). Kept terse: the gate
  enforces, so the prose no longer has to persuade.
- **Lint preset** (mechanical rules as executable checks): runs in the verify
  gate alongside typecheck/tests. Lint errors are just-in-time documentation —
  delivered at the violation, about only the rule violated.

## v0 scope

The **implement pipeline** (v0.2 shape, live):

clean-slate gate → feature-executor → verify → unit-test-writer → verify →
refactor → verify. Verify steps run cheap mechanical fix retries, then consult
the supervisor (read-only, `plan` permission mode) exactly once: retry with
guidance, or escalate. Executor terminations (`terminated:*`) escalate
directly — the report already carries the reasoning. Rate-limit hits park the
run (`paused-rate-limit`); `resume` re-enters the step walker, skipping every
step already marked passed.

Explicitly out of scope for v0: interactive planning (stays a conversational
skill — elicitation/grilling needs a human in the loop and is correctly built
elsewhere), the api driver, multi-run queueing, the self-improving loop.

## Roadmap

| Milestone | Ships |
|---|---|
| v0.1 | contracts + engine + implement pipeline, claude-code driver |
| v0.2 | supervisor + resume + rate-limit parking |
| v0.3 | friction capture → self-improvement loop — SHIPPED: agents report friction in WorkReport; engine appends to `.lightsout/friction.jsonl` with run/step provenance; `improve` feeds aggregated friction + prompt files to the prompt-improver role (edits the engine worktree; a human reviews the diff and ships) |
| v0.4 | SHIPPED: standards/style-card injection (`standards`/`testStandards` config → inlined into executor/test-writer/refactorer invocations; declared-but-missing file is a hard error); codex driver (`codex exec`, sandbox-mode mapping, `--output-last-message`, verified against codex-cli 0.128.0); consumer #1 wired via `lightsout.config.json` + committed style card |

## Decision log

| Decision | Choice | Why |
|---|---|---|
| Substrate | Drive harness CLIs headlessly; no Agent SDK core | SDK is API-key-only (~20x cost vs Max plan); CLI-driving is the officially supported subscription path; also yields harness-agnosticism for free |
| Distribution | Git repo is both plugin and engine; bundled `dist/cli.mjs` committed; no npm | Plugins are clones with no install hook; `/plugin marketplace add dc-devs/lightsout` is the entire install |
| Orchestrator | Deterministic code, not prose/LLM | LLM conductors miscount, skip, and mis-parse; determinism belongs in the cheapest reliable substrate |
| Where non-determinism is allowed | Inside agent steps + supervisor on failures | Judgment earns unreliability only where judgment is needed |
| Name | lightsout | Markets the outcome (runs unattended), not the mechanism (stopping); jidoka/andon rejected for foregrounding the brake |
