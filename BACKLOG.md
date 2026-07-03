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

Run `pnpm install`, `pnpm check`, `pnpm bundle`, and `node plugin/dist/cli.mjs help`.
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

### Task 3: Run lock — DONE

Result: `.lightsout/lock.json`, exclusive-create (`wx`) acquired by the
pipeline before any disk write (run id minted first so the lock names it);
live-pid holder → `RunLockError` fail-fast with a clean CLI message and no
orphan run directory; dead-pid or corrupt lock → stolen with a progress
announcement; released in a `finally` on every exit path (parks included).
`status` flags a `running` manifest with no live locked process as
crashed-but-resumable. 8 tests in `packages/engine/tests/runLock.test.ts`.

Two simultaneous runs in one consumer repo would fight over the worktree.

- Add a lockfile under `.lightsout/` acquired by `run`/`resume`, released on
  completion. A stale lock from a crashed process must be detectable and
  recoverable (e.g. record the pid; `resume` may steal a lock whose process is
  dead). A second concurrent invocation fails fast with a clear message.
- Cover the lock behavior in the Task 1 test suite.

### Task 4: Plugin ignition — prepare, don't test — DONE

Result: the path assumption was broken at the root — marketplace installs
copy ONLY the plugin source dir to
`~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` (verified against
the installed agent-capabilities plugin's cache layout), so
`${CLAUDE_PLUGIN_ROOT}/../dist/cli.mjs` pointed at nothing. Fix: the bundle
moved INSIDE the plugin (`plugin/dist/cli.mjs`, sole build output; root
`dist/` removed; every doc/alias/fixture reference updated); the skill now
runs `run --plan "<path>"` with `--overview`/`--packages`/`resume`
passthrough; plugin version bumped to 0.0.2.

Human test checklist (interactive session required):
1. `/plugin marketplace add dc-devs/lightsout` (or the local repo path)
2. Install the `lightsout` plugin; confirm
   `~/.claude/plugins/cache/lightsout/lightsout/0.0.2/dist/cli.mjs` exists
3. In a consumer repo with `lightsout.config.json`: `/implement <plan-path>`
4. Confirm the skill invokes `node "$CLAUDE_PLUGIN_ROOT/dist/cli.mjs" run
   --plan ...` and relays the final report
5. Kill it mid-run, `/implement resume <run-id>` → resumes

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

Target shape (added 2026-07-03, from comparing the docs to lightsout's own
8-line CLAUDE.md Conventions block, which agents follow reliably): a terse
style card keeps only three kinds of content —
1. the project's CHOICE among idioms the model already knows, one line each
   ("one export per file", "no enums: as-const object + derived union");
2. numeric thresholds the model can't guess (component >200 lines →
   extract; hook >160);
3. rules that CONTRADICT model defaults (it would otherwise do the
   idiomatic-but-unwanted thing).
Everything else — persuasion, rationale, examples, tables restating
defaults — was written for a world where prose had to convince an
unenforced agent. The gate enforces now; cut it. Task 6 measures the
before/after token weight.

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
- Consider landing on top of Task 7's event stream — the usage fields arrive
  in the same result event the transcript tee already parses.

### Task 7: Live agent transcript (added 2026-07-03)

Today the claude-code driver runs `claude -p --output-format json`: ONE JSON
envelope when the agent finishes. During a 30-minute implement step the user
watches a silent `[+m:ss]` clock with zero insight into what the agent is
doing — the observed pain of run #2.

- Switch the driver to the streaming output format (`--output-format
  stream-json`, likely requires `--verbose`; VERIFY the exact flags and
  event shapes against the installed claude binary FIRST — hard rule). Check
  what `codex exec --json` streams; degrade gracefully to today's behavior
  for drivers with no stream.
- Tee the raw event stream to `.lightsout/runs/<id>/agents/<step>.<attempt>.jsonl`
  — the full chat becomes on-disk evidence (audit-trail thesis), and
  `tail -f` on that file IS live access to the current chat.
- Surface a compact line per meaningful event through the existing
  onProgress stream: tool calls (name + file/command), agent text snippets —
  so the running CLI tab narrates the agent's actual activity.
- Optional follow-up: `lightsout logs --run <id> [--follow]` to pretty-print
  a transcript without hand-tailing JSONL.
- Read-only by design: watching the chat, never steering it mid-step. A
  human injecting guidance mid-agent-turn would reintroduce the prose
  orchestrator the engine exists to replace; course-correction stays where
  it belongs — gates, supervisor, escalation.

### Task 8: Refactor pipeline (`lightsout refactor`) — DESIGN ONLY, review with the user before any code

(Added 2026-07-03 from the refactor-system discussion. The design below is a
starting point, NOT approved scope — walk it with the user first.)

Goal: a system that keeps a codebase structurally clean — duplicate
functions found and abstracted, oversized files/folders split — rinsed and
repeated until clean, so agent-added features land in a codebase that
already adheres to a shape. The v1 `refactor-all` skill asked an agent to
both FIND and fix problems; finding is mostly mechanical. The lightsout
shape: **detection is code, remediation is agents, verification is gates,
termination is scanner-clean.**

Pipeline: clean-slate gate → run detector suite → typed findings work-list
in a run manifest (file, kind, evidence, cluster) → one refactor agent per
finding-cluster (the per-file test-writer fan-out pattern), each handed a
specific defect, never "go find problems" → gates per batch → re-scan →
loop until detectors return empty → test-writer for changed files → final
verify. Detectors configured per consumer (born generic) with bundled
JS/TS defaults, like the standards.

Detector suite, duplication as a three-tier ladder:
1. jscpd — literal/near copy-paste (token-span matching; catches renamed
   FUNCTIONS with identical bodies, misses systematic identifier renames).
2. Normalized-AST detector (ours, ~100 lines, TS compiler API): identifiers
   → placeholders, hash function bodies, compare — catches the renamed tier.
3. Behavioral duplicates: mechanical candidate-pair generation (signature
   shape, folder/domain, call-site overlap) → agent judges each bounded
   pair. Judgment only where judgment is irreplaceable. Ship 1+2 first;
   hold 3 until they dry out on a real codebase.
Plus: size/complexity audit (the standards' numeric thresholds run as
checks), folder census (flag oversized flat folders — packages/engine/src
is the live specimen and first dogfood target), knip for dead exports.

Related, kept loose per the user: no prescriptive architecture "map" —
code SHAPE guidance stays light, and placement decisions belong to the
(future, not yet designed) planning step. Module-boundary lint rules
(dependency-cruiser) remain a Task 5 option, not a mandate.

Also cheap and independent: give the in-run refactor step's prompt the v1
refactor-plan audit method (per-file full read, cite the violated rule per
change, severity ordering) — better changes and better friction data.

## Rules for all work

- Follow `CLAUDE.md` conventions exactly (one export per file, object params,
  no return-type annotations, no enums, parse-don't-cast, tabs).
- `plugin/dist/cli.mjs` is COMMITTED: rebuild (`pnpm bundle`) and include it
  in any commit that touches package source.
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
