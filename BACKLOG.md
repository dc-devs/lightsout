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

### Task 5: Clean up the default standards (`standards/`) — DONE (2026-07-04)

Result: 26 docs → 22; whole-bundle 15.8k words → channelled: base 7.5k
(−52%, what a backend run carries), react 8.8k, tanstack 9.2k. Channels
activate from scoped packages' package.json deps (`standardsChannels`
config replaces detection); provenance-tested (87/87). Evidence-gated
cuts only: friction-scarred sections (boundary testing, setup factories,
mock cleanup, precedence) kept intact; duplicate examples, restated model
defaults, the agent-contradicting "Running Tests" section, and all stale
fdrop: links removed; import-type/avoid-any/formatting collapsed into
lint-and-formatting.md with the binding-preset bridge. Test additions
landed (assertions-pin-contracts doctrine). Deeper terse-style-card
compression deliberately deferred until more run evidence accumulates.
Inventory that drove it: .notes/standards-inventory.md (local).

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

Test standards additions (2026-07-03, from live run review): assert
contracts with literals — never import a constant from the module under
test into its own assertions (a test comparing x to x is a tautology; the
test literal is the independent second statement of the contract). Pin
machine-facing values (error codes) strictly; pin human-facing copy loosely
(`stringContaining`) or not at all. Construct the subject under test
directly; stub only unowned boundaries. Prefer behavior assertions over
property echoes. The future refactor pipeline (Task 8) must EXCLUDE
source→test literal repetition from duplication detection, or it will DRY
assertions into tautologies.

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

### Task 6: Token/cost accounting per run — DONE

Result: driver normalizes the stream result event's usage
(input/output/cache tokens + total_cost_usd, fields verified live against
claude 2.1.200; codex reports nothing and leaves no ledger);
invokeAgentWithContract sums usage across re-emit retries; every
invocation appends to the run's `agents.jsonl` with step provenance and is
narrated live (`implement · usage: in 12 · out 41.2k · cache-read 890k ·
$0.85`); the manifest carries the run-wide `usage` aggregate (seeded on
resume, so totals survive process boundaries) and the CLI prints it in
the final report. 68/68 tests (re-emit summing; ledger + aggregate +
narration; no-usage driver leaves nothing); live smoke green. Task 5's
measurement instrument is now in place.

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

### Task 7: Live agent transcript (added 2026-07-03) — DONE

Result: claude driver now runs `--output-format stream-json --verbose`
(event shapes verified against claude 2.1.200; final result envelope read
from the stream's `result` event, old whole-stdout parse kept as fallback);
`spawnCollect` gained per-line streaming; every invocation's events are
teed in arrival order to `agents/stream-NN-<step>.jsonl`; tool calls are
narrated live through onProgress (`implement · Edit: src/...`); the CLI
report prints the transcripts dir. Codex: no event stream in 0.128.0,
degrades to prior behavior. 65/65 tests (describeAgentEvent unit tests +
pipeline tee/narration); live smoke via real driver — 15 events, PASS.
FOR TASK 6: the probe verified the result event carries `usage`
(input/output/cache tokens), `total_cost_usd`, `num_turns`, `duration_ms`,
and `modelUsage` — the accounting data source is confirmed and already
being persisted into every stream transcript.

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

### Task 8: `lightsout scan` — structural detector suite — V1 DONE (2026-07-04); v2 remediation remains

V1 result: `lightsout scan [--cwd] [--path]`, six detectors (tier-0 name
dedup w/ synonym collapse, jscpd clones via @jscpd/core, normalized-AST
body hashing via the CONSUMER's TypeScript with honest degrade, size
thresholds, structure lint w/ closed exceptions encoded, dead-export
reference counting — knip deliberately replaced: unbundleable, and
name-counting suffices for advisory). Typed ScanFinding[] persisted to
.lightsout/scan.json (v2's work-list). 89/89 suite incl. planted-defect
fixture. BOTH ground truths validated live: lightsout's engine flat-folder
census + 3 real internal duplications found (spawnCollect↔runCommand,
invocation-builder twins, appendLog twins, readFriction↔summarizeRun
lambda); FeedbackDrop scan rediscovered the exact processor create/update
clone the phase-2 refactor agent flagged (linear-sync.processor 96-137 ↔
192-233) plus its GitHub mirror. Path-scoped dead-export false positive
found live and fixed (references always count repo-wide). Deviations from
original spec: knip → own reference counter (reason above).

The lightsout shape: **detection is code, remediation is agents,
verification is gates, termination is scanner-clean.** V1 is the detection
half only — a read-only command (same spirit as `doctor`, about code shape
rather than environment) printing a typed findings report. Remediation
agents are v2.

Detector suite (v1):
- **Tier 0 — filename dedup** (from 3rd-party review): token-overlap /
  edit-distance over export names. One-export-per-file makes filenames
  export names, so name-level dedup is nearly free and runs before any AST
  work.
- **Tier 1 — jscpd**: literal/near copy-paste (token-span; catches renamed
  functions with identical bodies). Test files EXCLUDED from source→test
  comparisons: assertion literals are contract-pinning, not duplication —
  DRYing them creates tautologies (doctrine recorded 2026-07-03).
- **Tier 2 — normalized-AST hashing** (ours, ~100 lines, TS compiler API):
  identifiers → placeholders, hash function bodies, compare. Catches
  systematic renames (live specimen: handleFdToGithubCreate/Update vs
  handleFdToLinearCreate/Update twins in FeedbackDrop).
- **Tier 3 — HELD**: agent-judged behavioral candidate pairs; not until
  tiers 0–2 dry out on a real codebase.
- **Size/threshold audit**: the standards' numeric tables run as code —
  functions >80 lines, files >250, components >200, hooks >160.
- **Structure lint** (from 3rd-party review): files with 2+ exports outside
  the closed exception list; filename ≠ export name; `utils/` folders with
  2+ functions sharing a domain (heuristic — advisory only, never a hard
  finding); folder census (oversized flat folders — packages/engine/src is
  the dogfood specimen, now 40+ files).
- **knip**: dead exports (the "delete unused code immediately" rule,
  mechanized).

Build notes: jscpd + knip land as lightsout devDependencies (bundled
tooling; consumers install nothing) — confirm at build time. Command name
TBD (`scan` vs `refactor --scan-only`). Detectors configured per consumer
(born generic) with bundled JS/TS defaults, like the standards. Findings
are typed (zod) with file/kind/evidence/cluster — the shape v2's
remediation work-list needs.

Validation: run on lightsout engine/src, then FeedbackDrop — the report
must independently rediscover the known processor duplication the phase-2
refactor agent flagged (ground truth).

V1.1 (queued 2026-07-04 from the first full FeedbackDrop scan — 552
findings, ~60% signal; these take it to ~85% and make observation
sustainable):

1. **Filename-mismatch suffix stripping**: strip framework suffixes
   (`.model`, `.dto`, `.entity`, `.input`, `.args`, …) before comparing
   filename to export name — `session-response.model.ts` exporting
   `SessionResponse` is convention, not a mismatch. ~130 of FD's 142
   mismatch findings are this one gap.
2. **Tier-0 to/from inversion guard**: token-sorting collapses deliberate
   opposites (`hexToRgb` vs `rgbToHex`) into "one concept under two
   names" — keep order sensitivity when names contain to/from conversion
   shape. Related: a component + its kebab route file (`GetStarted` vs
   `get-started`) is a legit framework pair, not a dup.
3. **Consumer-TypeScript workspace fallback**: resolveConsumerTypescript
   only tries the repo root — pnpm workspaces keep typescript in package
   node_modules, so FD's full scan ran with tier 2 skipped entirely. Try
   scoped packages' manifests before giving up.
4. **Baseline ratchet**: first scan writes `.lightsout/scan-baseline.json`
   (accepted debt); later scans report only NEW findings vs baseline
   (cluster keys are the stable diff identifiers — designed for this).
   `--all` shows everything. Turns a 552-finding brownfield report into
   "what did this change add?" and the baseline into the deliberate
   burn-down list (or v2's remediation queue).
5. **Threshold config**: expose `scan: { minCloneTokens }` (default 50;
   FD's 16-line-median clone tail suggests ~70 for that repo) — per-repo
   floors, not a global guess.
6. **Dominant-path self-diagnosis**: when one directory produces >50% of
   findings, say so in the report header — a 2,235-findings-from-one-
   generated-dir report should diagnose its own config gap (live case:
   Prisma client dir missing from `generated`).

V2 (separate, after v1 evidence): remediation pipeline — clean-slate gate →
scan → one refactor agent per finding-cluster (test-writer fan-out
pattern), each handed a specific defect, never "go find problems" → gates
per batch → re-scan → loop until scanner-clean → test-writer for changed
files → final verify. Also in v2's scope: give the in-run refactor step's
prompt the v1 audit method (per-file full read, cite the violated rule,
severity ordering), and evaluate the in-run refactor step's cost/value with
the accumulated report-card data (phase 2: $8.51 across 4 invocations for
1 changed file — on trial).

Kept loose per the user: no prescriptive architecture "map" — placement
decisions belong to the future planning phase (Task 13).

### Task 9: `lightsout doctor` — consumer environment audit (added 2026-07-04) — DONE

Read-only command that checks every assumption the engine and the standards
make about a consumer repo, printing PASS/WARN per check with the exact
one-line fix for each WARN. Never mutates: setup-by-mutation makes repo-wide
behavior decisions silently — the live specimen is `clearMocks: true`, two
config lines that broke 22 FeedbackDrop tests and needed a human-judged fix.
The doctor tells you what, why, and what to paste; you ship it. (Same
philosophy as `improve`: the loop proposes, a human ships.)

Checks (grow the list as Task 5 makes standards assumptions explicit —
every standard that assumes environment state contributes one check):
- `lightsout.config.json` parses against the contract
- Jest config per package: `clearMocks`/`restoreMocks` set (the test
  standards' Mock Cleanup section assumes them)
- scoped-gate scripts: which packages lack which `packageScripts` targets
  (today's skip narration, available before a run)
- `.gitignore` covers `.lightsout/runs/`, `friction.jsonl`, `lock.json`
- harness binary present + logged in (driver-specific probe)
- `generated` paths exist; `scripts.*` commands resolvable
- later: lint config presence once lint standards exist

Fits the run header afterwards ("2 doctor warnings — run `lightsout
doctor`") without ever gating.

### Task 14: NEXT IMMEDIATE — phase-3 conformance review + cleanup list (added 2026-07-04)

Review the "new" files phase 3 produced (run
68e67550-81dc-48f6-8e01-3297c72adbc2 in FeedbackDrop) against the newly
slimmed standards: did the writers actually conform to the style they
reported conforming to? Every non-conformance or cleanup item found gets
APPENDED HERE as it's discovered — this task is the collection point.

Files to review: the run manifest's per-step changedFiles (implement ~
sources, write-tests ~ new test files in setup-factory style, refactor's
touched file). Judge against: setup-factory/flat-describe/AAA, assertions-
pin-contracts (literals, codes-strict/copy-loose), mock typing rules,
one-export-per-file, Params/return-types, naming.

Cleanup list (seeded from the phase-3 friction review; append below):

- [ ] ENGINE/standards: `userEvent` mandate made conditional on the package
      actually depending on @testing-library/user-event (unconditional rule
      broke a check gate with TS2307; agent fell back to fireEvent). Also a
      doctor-check candidate.
- [ ] ENGINE/standards+prompt: known style-precedence conflicts recorded
      ONCE per run, not once per file (~24 near-identical entries drowned
      the phase-3 friction log).
- [ ] FD (user decision): install @testing-library/user-event in web-app,
      or keep fireEvent as the repo's interaction API.
- [ ] FD (user decision): delete the legacy FindOneIssueDocument.unit.test.ts
      string-echo test (standards say pure-constant gql Documents get no
      dedicated test; 5 writers independently flagged it).
- [ ] FD (user decision): the gen:gql verification gap — regeneration needs
      a live backend the verify environment lacks; agent hand-wrote the
      deterministic codegen output as a documented deviation. Decide: live
      backend in verify env / explicit implementer deliverable / accept
      documented hand-writes. (Also Task 13 planning-phase material.)
- [ ] FD (observation): recurring jest-worker SIGSEGV under coverage (2nd
      occurrence, different file each time); gate re-run absorbed both.
- [ ] FD (inventory, no urgency): the ~20 legacy GitHub-side test files the
      phase-3 writers named while applying the precedence rule — the
      deliberate-cleanup queue for Task 8 v2 / a dedicated style-migration
      plan.

### Task 10: Prior-art contract field — implement phase (added 2026-07-04)

Duplication attacked at creation time (the scanners catch it at detection
time — complementary layers). The executor's WorkReport gains a typed
field: for each NEW exported symbol it creates beyond the plan's explicit
list, the searches it ran against existing exports (terms, globs, matches
found). "Searched, found nothing" becomes zod-validated evidence in the
manifest, not free text. Prompt section to match. Small: contract field +
prompt + tests.

When the planning phase (Task 13) lands, prior art for PLAN-listed symbols
moves there (the cheapest moment to catch designed duplication is when the
plan line is written); this field then covers only unplanned symbols —
which is what it's best at.

### Task 11: Standards edits from the 3rd-party agent-navigation review (added 2026-07-04)

Source: .notes/plans/agent-repo-organization.md. Core principle adopted:
agents navigate by glob/grep — names are the database keys. Four edits,
two with caveats we insist on:

1. **Closed verb vocabulary** in naming.md (`get`, `create`, `update`,
   `delete`, `format`, `parse`, `validate`, `build`, `to`/`from`,
   `is`/`has`/`should`/`can`; synonyms `fetch`/`load`/`retrieve`/`make`
   banned) — synonyms hide duplicates from name-level search (Task 8 tier
   0 depends on this). CAVEAT: subordinate to the precedence rule — an
   existing domain that already uses `fetchData` keeps its verb; the
   vocabulary governs new domains.
2. **Feature-noun top level** for `src/` (never layer-first
   `controllers/`/`services/`) — CAVEAT: framework mandates override
   (NestJS et al.), same carve-out as file naming.
3. **Fractal skeleton** one-liner: graduated feature folders share one
   internal shape; no feature invents its own.
4. **Per-folder READMEs** only for genuine invariants not derivable from
   published rules; no prose restating structure.

Explicitly REJECTED from that review (do not implement): one-function-per-
file (private co-located helpers are correct); forced folder scaffolding
on every module (graduation stays lazy). DEFERRED from that review: symbol
catalog INDEX.md generator (stale-prone, token-heavy, duplicates grep —
revisit only if Task 10's prior-art searches prove insufficient);
import-boundary lint (consumer-side eslint/dependency-cruiser config — an
FD item below, plus a future doctor check).

### Task 12: Deterministic-standards follow-through (small, consumer-facing)

The deterministic slice of the standards that ISN'T Task 8 detectors:
biome/eslint one-liners (`useImportType`, `noExplicitAny`,
`noExtraneousClass`…) enabled in the CONSUMER's lint config (lightsout
ships no npm preset — hard rule). Lightsout side: a doctor check that the
recommended rules are on (grow the doctor checklist), and keep the
lint-and-formatting.md bridge line current. FD side tracked below.

### Task 13: Planning phase (added 2026-07-04 — the next pipeline frontier)

A phase BEFORE implement that produces/vets the plan itself. Collected
design notes so nothing is lost:

- **Prior-art scan as a first-class plan artifact** (from the 2026-07-04
  discussion): every "new file/symbol" entry in a plan carries the
  searches that justified its newness; a plan gate can reject unvetted new
  symbols. Highest-leverage dedup moment — changing a plan line is free.
- **`deliverables:` front-matter** (discussed 2026-07-03, phase-1
  migration lesson): plans declare mechanical artifacts gates can't see
  (e.g. a migration folder) for an existence-only engine check — the
  middle ground between plans listing ALL files (too rigid) and none
  (nobody accountable for the migration).
- Plan quality gates: scope resolvable (packages), referenced paths exist,
  decision-level gaps surfaced (the fdrop gap-check/lint-plan skills are
  prior art).
- Placement decisions (where new code lives) belong here, not in a
  prescriptive architecture map (per Task 8 note).
- Shape TBD: `lightsout plan <request>` producing a plan draft vs a
  plan-vetting gate on `run` (`lightsout run --plan` validating before
  clean-slate) vs both. Design with the user before code.

### Consumer-side (FeedbackDrop) tracked items — not engine work, listed so nothing is lost

- Commit pending FD changes: jest config (clearMocks/restoreMocks), 4
  rewritten mastra agent tests, lightsout.config.json (agentCommands +
  schema.gql in generated).
- Jest mock-cleanup migration for the other 7 configs the doctor found
  (backend-api e2e, fdrop-cli, mcp, react, shared, web-app, widget) — one
  package at a time, full suite after each.
- Biome rules audit per Task 12 (useImportType, noExplicitAny, etc.).
- Import-boundary lint (eslint-plugin-boundaries or dependency-cruiser) —
  deferred 3rd-party item 9.
- GitHub-warts cleanup after phase 3: delete the dead
  `connection.workspaceId !== workspaceId` clause
  (linear-integrations.service.ts:155, Linear-only); extract the shared
  create/update handler flow in BOTH sync processors symmetrically
  (github-sync.processor.ts:74/146, linear-sync.processor.ts:77/173) — a
  natural first target for Task 8 v2 or a small lightsout-run plan.
- Phase 3 of linear-two-way-sync: first run on slimmed standards —
  its standards-friction count is the Task 5 experiment's readout.

### Task 2: First full pipeline run on the codex driver (live) — LAST, deprioritized 2026-07-03

The codex driver has only done a round-trip smoke test, never a full
pipeline run. (Moved to the end of the backlog: the claude-code path is the
proven consumer path; codex additionally lacks the event stream, so it gets
no live transcript or usage ledger until this task revisits it.)

- In `fixtures/toy-calc`, temporarily set `"driver": "codex"` in
  `lightsout.config.json` and run `plans/power.md`.
- Acceptance: run reaches PASSED (or you report exactly where and why it
  didn't — an honest failure report is a valid outcome). Afterwards, reset the
  fixture (`git checkout -- fixtures/toy-calc` + remove untracked files it
  created) so `power.md` stays unimplemented for the quick start.
- Note any codex-specific quirks (output shape, sandbox behavior) in code
  comments on the codex driver.
- Since deferred: verify against the installed codex CLI whether it has
  grown a JSON event stream / usage reporting (0.128.0 had neither) —
  transcript + accounting parity is part of finishing this task.

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
