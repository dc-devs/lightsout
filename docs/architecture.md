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
| `cli` | `run`, `resume`, `status`. Bundled to `plugin/dist/cli.mjs`. |

## Non-negotiable rules

1. **The engine never handles model credentials.** Drivers spawn the user's
   own logged-in harness (`claude -p`, `codex exec`). This is simultaneously:
   the harness-agnostic story, the subscription-billing story (headless
   `claude -p` rides the user's Max plan; the Agent SDK is API-key-only and
   explicitly blocked from subscription auth — verified against official docs,
   2026-07), and what keeps the project clear of the third-party-auth policy.
2. **The plugin skill is the ignition, not the engine.** No gates, retries, or state in markdown,
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

The repo ships default JS/TS standards in `standards/code/` and
`standards/tests/`, bundled into `plugin/dist/cli.mjs` at build time (like the agent
prompts, so plugin clones carry them). They load when a consumer's config
says nothing about standards — announced in the run header, never silent —
and `false` opts out explicitly (the coverage-gate pattern). The reserved
config tokens `lightsout:code-defaults` / `lightsout:test-defaults` let a
consumer stack the defaults with repo-specific extras. Regenerate the
barrels after editing the docs: `node tools/generateStandardsBarrels.mjs`
then `pnpm bundle`.

## v0 scope

The **implement pipeline** (v0.6 shape, live):

clean-slate gate → feature-executor → verify → unit-test-writers (one per
changed source file, up to 5 in parallel) → verify → refactor (looped, ≤3
passes, until a pass reports `complete` with zero changed files) → verify →
format. Verify steps run cheap mechanical fix retries, then consult the
supervisor (read-only, `plan` permission mode) exactly once: retry with
guidance, or escalate. Executor terminations (`terminated:*`) escalate
directly — the report already carries the reasoning. Rate-limit hits park the
run (`paused-rate-limit`); `resume` re-enters the step walker, skipping every
step already marked passed.

Changed-file truth is double-entry: after every work step the agent's typed
report is merged with a git snapshot diffed against the run's baseline dirt
(refreshed after clean-slate, so gate artifacts like coverage output are
never attributed to agents), and the merged list is what the next role's
invocation receives (fix re-invocations included). An implement step that
changes nothing fails instead of passing vacuously. The coverage gate
(`scripts.testCoverage`, opt-out only) runs at clean-slate and every verify
after tests exist; `build` and `format` are opt-in gates.

In monorepo mode (`packageScripts` templates; `{package}` → the package's
package.json name; a template without the placeholder is a config error)
every gate runs scoped to the run's package scope — `--packages` flag, else
the plan front-matter `packages:` list, else derived from concrete
`packagesDir/<name>/` paths in the plan body (source recorded in the
manifest; safe because over-inclusion only runs extra gates and
under-inclusion is caught by expansion), else a hard error before any agent
spawns — widened automatically as changed files reveal the true blast
radius, never shrunk. Whole-repo `scripts.*` demote to a root group that
runs only when files outside `packagesDir` change.

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
| v0.5 | SHIPPED: parity batch from the v1 orchestrator review — git-truth changed files (agent report ∪ `git status` vs run baseline), zero-change implement gate, per-file parallel test writers (5 concurrent), refactor loop (≤3 passes, typed completion signal), coverage gate (opt-out only), opt-in build/format gates, `--overview` phased-plan context, decision-kind friction |
| v0.6 | SHIPPED: monorepo scoped gates — `packageScripts` command templates per affected package (parallel, `{package}` = package.json name, placeholder required by config validation), scope chain `--packages` → plan front-matter → derived from plan-body paths → hard error (source recorded in the manifest), auto-widening from changed files, root group for files outside `packagesDir` |

## Decision log

| Decision | Choice | Why |
|---|---|---|
| Substrate | Drive harness CLIs headlessly; no Agent SDK core | SDK is API-key-only (~20x cost vs Max plan); CLI-driving is the officially supported subscription path; also yields harness-agnosticism for free |
| Distribution | Git repo is both plugin and engine; bundled `plugin/dist/cli.mjs` committed; no npm | No install hook exists, so the runnable artifact must ship in the repo; `/plugin marketplace add dc-devs/lightsout` is the entire install. The bundle lives INSIDE `plugin/` because marketplace installs copy only the plugin source directory to `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` — the surrounding repo (and a root `dist/`) does not exist at runtime (verified against the installed claude 2.1.x cache layout, 2026-07) |
| Orchestrator | Deterministic code, not prose/LLM | LLM conductors miscount, skip, and mis-parse; determinism belongs in the cheapest reliable substrate |
| Where non-determinism is allowed | Inside agent steps + supervisor on failures | Judgment earns unreliability only where judgment is needed |
| Name | lightsout | Markets the outcome (runs unattended), not the mechanism (stopping); jidoka/andon rejected for foregrounding the brake |
| Test runner | `node:test` + stub drivers; no Jest | The Driver interface is an explicit injection seam, so Jest's module-interception value goes unused and its dependency tree contradicts the thin-machinery thesis; live agent runs are a separate verification tier, never per-commit tests. Revisit only if a concrete need (rich matchers, snapshots at scale) actually appears |
| Changed-file truth | Agent report ∪ git-status diff vs run baseline | Agents forget files; git cannot be sweet-talked; downstream roles (test writers, refactorer) need the full set or work silently escapes them |
| Coverage gate | On by default — `testCoverage` must be a command or an explicit `false`; in gate sets that include coverage it REPLACES the plain test run (contract: the coverage command must run the unit tests) | Skipping the strongest gate must be a decision, not an accident; the consumer's command owns the threshold, the engine only reads the exit code. Running testUnit then testCoverage is the same suites twice back-to-back — observed live: 7s + 22s per gate set for identical verification |
| Refactor completion signal | Typed: `complete` + empty `changedFiles`, max 3 passes | Replaces v1's `REFACTORING_COMPLETE` prose marker — no string matching at any boundary |
| Monorepo gates | Opt-in `packageScripts` templates; `{package}` = package.json name; groups run in parallel | Whole-repo gates let one unrelated red package block every run and made the coverage bar repo-wide. Cross-package blast radius belongs to the consumer's filter template (`--filter ...pkg` includes dependents) — the engine stays dependency-graph-free |
| Package scope source | `--packages` flag → plan front-matter → derived from plan-body paths → hard error; widened from changed files, never shrunk | The plan is where scope knowledge lives; no plan tool emits scope metadata, so the path-derivation tier makes zero-metadata plans work — it is admissible because both failure directions are safe (over-inclusion runs extra gates; under-inclusion is caught by expansion), and the manifest records the source so derived scope is never mistaken for declared |
| Agent-turn file filter | JS/TS allowlist (`.js/.jsx/.ts/.tsx` + m/c variants), not a denylist | Every test-writer spawn is a model call; a denylist makes unknown extensions default to a wasted turn, an allowlist makes them default to free. Non-JS/TS changes stay tracked in the manifest and gated — they just earn no agent turns |
| Gate evidence | Every gate command execution appended to the run's `commands.jsonl` (step, group, kind, exit code, duration; output tail on failure) | A green gate that leaves no evidence is indistinguishable from a gate that never ran; first live run surfaced exactly this blind spot |
| Agent timeouts | Config `timeouts` (default 60m agent / 15m supervisor); any driver exception is a recorded step failure, no blind retry | First live run died uncaught at the old 20m ceiling mid-implement, zombieing the manifest at `running`; a second identical timeout would just double the cost of learning the ceiling is too low |
| Codegen | Opt-in `scripts.generate`, run once before every gate set; `generated` prefixes excluded from attribution | Gates verify, generate mutates — codegen inside `check` blurs that and races across parallel package groups. Without the prefix exclusion, a schema edit regenerating ~50 client files would spawn a test writer per generated file |
| Run lock | One `.lightsout/lock.json` per repo, exclusive-create, acquired before any disk write; live pid = fail fast, dead pid = steal; released on every exit path (parks included — the lock guards the process, not the run) | Two simultaneous runs would fight over one worktree; pid-probing makes crash leftovers self-healing instead of bricking the repo. The first live run crashed once and left a `running` manifest zombie — `status` now flags those as crashed-but-resumable |
| Agent command grants | Opt-in config `agentCommands`: command prefixes injected into the executor's task as a `# Granted commands` section and relayed to the harness's allowed-tools flag; grants are for producing deliverables, never verification | Some plan deliverables only a command can produce (a migration generator needs the live dev DB); with no grant mechanism, nobody in the system was allowed to create them — the agent's role forbade shell, `scripts.generate` is the wrong shape (per-gate-set, no per-plan argument). The binding grant is the prompt section: harness allowed-tools is additive and cannot restrict a user whose own settings already allow more |
| Gate scheduling & flake policy | Scoped package groups parallel (disjoint by construction); the root group runs AFTER them, never concurrently; a red gate command gets one mechanical re-run (both logged, `rerun: true` on the second) before the verdict — synthetic -1 results (spawn failure/timeout) excluded | Whole-repo root commands overlap the scoped suites by construction: run concurrently they put multiple full test fleets on one machine, and a jest worker SIGSEGV at the final format gate failed an otherwise-green 7-step run. Two consecutive reds are a genuine red; one is evidence of nothing |
| Scoped gates skip missing scripts | A scoped gate whose template targets a `run <script>` the package doesn't define is skipped — narrated live and recorded in commands.jsonl (`skipped: true`, reason, no exit code); detection reads the package.json `scripts` map, never pnpm's error string; templates with no `run` token always execute (unknown ≠ missing). Root `scripts.*` never skip — they're explicitly configured | Plan-path scanning pulls packages into scope the consumer never hand-tuned: a live run died at clean-slate because `infra-local` has no scripts at all (`ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`), and the only workaround was echo-stub scripts in every such package. A package with nothing to check is a fact to record, not a failure — and not a silent pass (`--if-present` would hide typo'd script names repo-wide) |
| Agent transcripts | Driver streams harness events (`claude -p --output-format stream-json --verbose`, shapes verified against 2.1.200); engine tees each invocation to `agents/stream-NN-<step>.jsonl` — evidence only, `tail -f`-able for live watching; the progress stream does NOT echo per-tool-call lines (revised 2026-07 after the first narrated live run: a working agent fires tools every few seconds and the commentary drowned the terminal — liveness now comes from step/gate/usage lines, detail from the file); outcomes still come solely from the final result + gates; codex has no event stream and degrades to today's behavior | A 30-minute implement step was a silent clock; when a run failed, the agent's actual conversation had to be recovered from harness-internal session files. Watching stays read-only: steering mid-step would reintroduce the prose orchestrator. Bonus: the result event carries usage/cost — the token-accounting data source, verified in the same probe |
| Usage accounting | Per-invocation token/cost ledger (`agents.jsonl`, step provenance, usage summed across re-emit retries) + run-wide aggregate in the manifest, narrated live and printed in the final report; source: the stream result event's `usage`/`total_cost_usd` (verified against claude 2.1.200); drivers reporting nothing leave no ledger | Runs spend the user's subscription invisibly; cost must be part of the audit trail, not a surprise. Also the measurement instrument for the standards prune (same run with/without defaults = the standards' token weight) |
| Standards channels + evidence-gated prune | Bundled default standards split into channels: base (always) + react + tanstack, activated per run by the scoped packages' package.json dependencies (config `standardsChannels` replaces detection). Content pruned against two runs of friction evidence: rules agents fought or cited stayed; restated model defaults, duplicate examples, and the agent-irrelevant "Running Tests" section (it contradicted the test-writer's no-shell rule) went. Result: backend runs carry 7.5k words vs 15.8k before (−52%); react runs 8.8k | Every agent invocation paid ~21k tokens of standards regardless of relevance — a Prisma migration run was carrying React component-testing docs. Cuts were evidence-gated (friction log + report citations), not intuition: with only two live runs of data, borderline rules were compressed, never deleted |
| Doctor is read-only | `lightsout doctor` audits the consumer repo against every assumption the engine/standards make (config, harness binary, gitignore, scoped-gate scripts, Jest mock-cleanup flags, generated paths, gate binaries), each warn carrying its exact fix — it never mutates; standards assumptions become doctor checks as Task 5 makes them explicit | Setup-by-mutation makes repo-wide behavior decisions silently: adding `clearMocks: true` to a real consumer broke 22 import-time tests that needed human-judged rework. Same philosophy as `improve` — the loop proposes, a human ships. First live audit found 7 more Jest configs without mock cleanup — and one false positive: the gitignore check line-matched instead of asking git, so `.lightsout` (no slash) warned; the check now shells `git check-ignore`, the only honest oracle for ignore semantics |
| Report extraction | Liberal in finding the payload (bare → LAST parseable fenced block → last balanced JSON object embedded in prose), strict in validating it (zod, unchanged); a rejected final message is persisted to the run dir and retried with a cheap re-emit invocation (rejected text + "reconstruct from this only"), never a full role re-run. One deliberate contract softening: friction `area` is telemetry, so an unrecognized label coerces to `other` (`detail` keeps the signal) instead of sinking the report | A live run failed twice while holding a valid report behind one sentence of preamble — 22 min of agent work dropped over formatting. Strictness belongs to the contract, not the search; a formatting slip should cost seconds, and its evidence must live in the run dir, not in harness-internal session files. "Last" was later proven twice in one message: a re-emitter self-corrected mid-reply, leaving the fixed report as a second fenced block the first-fence match discarded; and a valid zero-change refactor report died over an invented `"scope"` area — load-bearing fields stay strict, taxonomy degrades |
