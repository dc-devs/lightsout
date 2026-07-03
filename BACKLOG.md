# lightsout: get caught up, then work the backlog

You are working in the `lightsout` repo (`~/Developer/code/lightsout`) — a
deterministic engine for coding agents, built to v0.5 in a prior session. Your
job: orient fully, verify the baseline, then execute the backlog below in
order.

## Phase 1 — Orient (read before touching anything)

1. Read `CLAUDE.md` — settled decisions and conventions. The "Hard rules"
   section is non-negotiable; do NOT relitigate anything in it or propose
   alternatives to it.
2. Read `docs/architecture.md` — full design, the decision log (why each
   choice was made), and roadmap status (v0.1–v0.4 shipped).
3. Read `README.md` — the user-facing contract: install, config reference,
   CLI reference.
4. Run `git log --oneline` and read the commit messages newest-to-oldest —
   they narrate what was built and how each piece was verified.
5. Skim the package layout: `contracts` (zod schemas), `engine` (pipeline,
   manifest store, gates), `agents` (markdown prompts + invocation builders),
   `drivers` (claude-code, codex, spawnCollect), `cli`. Read
   `packages/engine/src/runImplementPipeline.ts` in full — it is the spine.

## Phase 2 — Verify the baseline

Run `pnpm install`, `pnpm check`, `pnpm bundle`, and `node dist/cli.mjs help`.
All must succeed before any work starts. If anything is red, stop and report —
do not fix forward.

## Phase 3 — Backlog (in this order)

### Task 1: Committed test suite for the engine (highest priority) — DONE

Result: `pnpm test` — 38 tests green in ~2s (`packages/engine/tests/`,
node:test via esbuild bundle, stub drivers + real temp git repos). Covers
every scenario below, including the v0.5/v0.6 additions.

The engine currently has NO tests of its own — the stub-driver smoke tests
that verified v0.2/v0.3 lived in a session scratchpad and are gone. Recreate them
as a permanent suite:

- Use Node's built-in test runner; add a `pnpm test` script. Keep it
  dependency-light. Tests must use STUB drivers only — zero live agent calls,
  zero network.
- Cover at minimum:
  - rate-limit result → run parks as `paused-rate-limit` with resume
    instructions in the error
  - verify-gate failure → cheap retries → supervisor escalate → run
    `escalated` with the supervisor diagnosis in the error
  - agent `terminated:*` report → `escalated` (not `failed`)
  - resume walker skips steps already `passed` and continues attempt counts
  - friction in a report → `.lightsout/friction.jsonl` with run/step
    provenance
  - empty friction → `runPromptImprovement` short-circuits without invoking
    the driver
  - `extractJsonReport` accepts bare JSON and fenced JSON, rejects garbage
  - manifest write→read round trip, `updatedAt` stamping, and
    corrupted-manifest rejection at the read boundary
  - `readStandards` throws on a declared-but-missing file
  - v0.5 additions: zero-change implement gate; git changed-file merge
    (baseline subtraction, `.lightsout/` exclusion, non-git degradation);
    refactor loop ends on `complete` + empty `changedFiles` (max 3 passes);
    per-file test-writer fan-out with batch failure aggregation; coverage
    gate wiring (clean-slate + post-test verifies only, `false` opt-out);
    opt-in build/format gate wiring; `--overview` content inlined into
    executor invocations
  - v0.6 scoped gates: scope chain (`--packages` → front-matter →
    plan-body path derivation → hard error) with `packagesSource` recorded;
    `scanPlanPackagePaths` boundary cases; packageScripts `{package}`
    placeholder validation; `readPlanPackages` front-matter forms (inline +
    block list);
    `{package}` substitution uses package.json name (missing = per-group
    error); scope widening from changed files; root-group activation only
    when root files change; non-monorepo behavior unchanged when
    `packageScripts` absent
- Acceptance: `pnpm test` green; suite runs in seconds; document the script in
  README's Development section.

### Task 2: First full pipeline run on the codex driver (live)

The codex driver has only done a round-trip smoke test, never a full
pipeline run.

- In `fixtures/toy-calc`, temporarily set `"driver": "codex"` in
  `lightsout.config.json` and run `plans/power.md`.
- Acceptance: run reaches PASSED (or you report exactly where and why it
  didn't — an honest failure report is a valid outcome). Afterwards, reset the
  fixture (`git checkout -- fixtures/toy-calc` + remove untracked files it
  created) so `power.md` stays unimplemented for the quick start.
- Note any codex-specific quirks (output shape, sandbox behavior) in code
  comments on the codex driver.

### Task 3: Run lock

Two simultaneous runs in one consumer repo would fight over the worktree.

- Add a lockfile under `.lightsout/` acquired by `run`/`resume`, released on
  completion. A stale lock from a crashed process must be detectable and
  recoverable (e.g. record the pid; `resume` may steal a lock whose process is
  dead). A second concurrent invocation fails fast with a clear message.
- Cover the lock behavior in the Task 1 test suite.

### Task 4: Plugin ignition — prepare, don't test

The `/plugin marketplace add` → `/implement` flow needs an interactive session
(human-only). Do NOT attempt it. Instead: statically verify the skill's path
assumption (`${CLAUDE_PLUGIN_ROOT}/../dist/cli.mjs` — check how plugin root
resolves for a marketplace whose plugin source is `./plugin`), fix the skill
if the path is wrong, and leave the human a short test checklist in the final
report. Known bug found in review: the skill invokes `run "<plan-path>"`
positionally but the CLI requires `run --plan <path>`; it also predates
`--overview`/`--packages`.

### Task 5: Clean up the default standards (`standards/`)

The docs were pasted wholesale from the fdrop skill tree (v0.7); they work
but carry weight. Goals:

1. Consolidate rules where possible.
2. Programmatic insertion — e.g. the TanStack Start architecture doc should
   only ride along when the target package actually uses TanStack Start
   (framework-conditional channels, not one blob for every consumer).
3. Separate lint rules from code standards — mechanical rules belong in the
   lint preset per the standards-layer thesis. BUT: the standards must still
   state that the lint preset is binding, so the rules get applied in repos
   whose lint config doesn't yet enforce them.
4. Remove anything the model already reliably knows — prose that restates
   model defaults is pure token tax (check friction/run evidence before
   cutting; keep rules agents actually violated).

Also: stale skill-tree cross-links (`../../fdrop:code:...`) throughout; the
`functions.md` reference to the refactor-plan skill should point at
`patterns/react-components.md` (added 2026-07-03).

### Task 6: Token/cost accounting per run

Runs spend the user's subscription invisibly. Capture per-invocation usage
and make cost a first-class part of the audit trail:

- The claude-code driver's JSON envelope carries usage fields (and cost in
  newer CLI versions) — VERIFY the exact field names against the installed
  binary before coding (hard rule); check what codex exec exposes, degrade
  gracefully where a driver reports nothing.
- Record per agent invocation with step/role provenance (an
  `agents.jsonl` beside `commands.jsonl`, or fields on the step records).
- Aggregate per run in the manifest; print in the final CLI report and the
  live progress stream (e.g. "step implement: agent report complete — 9
  changed file(s), 41k tokens").
- Standards weight is measurable from this: the same run with/without the
  default standards quantifies Task 5's prune payoff.

## Rules for all work

- Follow `CLAUDE.md` conventions exactly (one export per file, object params,
  no return-type annotations, no enums, parse-don't-cast, tabs).
- `dist/cli.mjs` is COMMITTED: rebuild (`pnpm bundle`) and include it in any
  commit that touches package source.
- Verify CLI flags against installed binaries before writing code that invokes
  them — never from memory.
- One focused commit per task, pushed to `origin main`. Honest commit
  messages: say what was verified and what was not.
- Every task lands with verification. Report failures as failures — never
  paper over a red gate.
- Update this file as you go: mark tasks done with a one-line result; add
  newly discovered work to the backlog rather than scope-creeping into it.

## Final report

For each task: done/partial/skipped, how it was verified (command + result),
and anything discovered that belongs on the backlog. List any deviations from
this brief and why.
