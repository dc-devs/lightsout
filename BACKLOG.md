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

### Task 8: `lightsout scan` — structural detector suite — scan tool DONE (2026-07-04); Scan Gate + Cleanup Pipeline remain

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

V1.1 — DONE 2026-07-04 (queued the same day from the first full FeedbackDrop
scan: 552 findings, ~60% signal). Live results on FD: tier 2 ran for the
first time via the workspace fallback (+67 ast-duplicates, +107 size),
filename-mismatch 142→87 with the survivors verified as real signal
(users.seed→getUsers, four job-options twins, an actual 'inteface' typo),
to/from inversions zero, baseline of 601 clusters accepted, follow-up scan
reports 0 findings. Baseline design revised same day after user review:
explicit `--baseline` flag only (never a side effect of a plain scan) and
the file moved to the repo root as committed `lightsout.scan-baseline.json`
— a reviewable debt ledger à la phpstan-baseline.neon, not invisible local
state under gitignored .lightsout/. All six items:

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

SCAN GATE — DONE 2026-07-05 (formerly v2a): scan runs at the top of every
refactor pass (persist:false, so the user's standalone scan.json is never
clobbered), findings filtered to the run's changed files
(selectScanFindings) with the committed baseline suppressing accepted debt.
`finding`-severity items become a `# Scan findings` section in the refactor
prompt (typed work-list; standards audit KEPT alongside per 2026-07-05
ruling — revisit with report-card data, $8.51/4 invocations/1 file in
phase 2). Loop exits only when a pass changes nothing AND no gating
findings remain; survivors after 3 passes → Escalated naming the clusters,
and the cap-with-changes exit re-checks so the gate can't be escaped.
Line-key caveat resolved as designed: only stable path-keyed clusters gate
(ast:, multi-export:); clone/size inform the work-list but never block.
Suite 95/95 (prompt-injection + escalation pipeline tests).

CLEANUP PIPELINE (formerly v2b — later, after Scan Gate evidence): standalone run
type consuming the baseline ledger as its work-list — clean-slate gate →
scan → one refactor agent per finding-cluster (test-writer fan-out
pattern), each handed a specific defect → gates per batch → re-scan → loop
until scanner-clean → test-writer for changed files → final verify. This is
the ONLY thing that shrinks the accepted-debt baseline (601 clusters on
FD); every "that's deliberate cleanup, not your run" rule in the standards
points here.

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

### Task 14: phase-3 conformance review + cleanup list (added 2026-07-04 — LIGHTSOUT SIDE DONE 2026-07-04; open boxes below are FD handoffs for the user)

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

Scope rule (settled 2026-07-04): backlog tasks implement LIGHTSOUT changes
only. FD-side findings are handoff notes for the user to act on in FD —
never actions taken from here.

Cleanup list (seeded from the phase-3 friction review; append below):

- [x] ENGINE/standards: `userEvent` mandate now conditional on the package
      depending on @testing-library/user-event; fireEvent otherwise; agents
      never add the dep. Plus a doctor `note` (user-event check) when a
      package has @testing-library/react|preact without user-event —
      live-verified on FD (flags web-app AND widget). (2026-07-04)
- [x] ENGINE/standards+prompt: applying the style-precedence rule is now
      "normal operation, not friction" — one entry only when the rule itself
      failed (non-stylistic or ambiguous case). unitTestWriter.md +
      unit-testing.md. Kills the ~24-entry-per-run noise at the root.
      (2026-07-04)
- [ ] FD handoff (user): install @testing-library/user-event — doctor shows
      BOTH web-app and widget need it. (User confirmed intent to install.)
- [ ] FD handoff (user): delete the legacy FindOneIssueDocument.unit.test.ts
      string-echo test (standards say pure-constant gql Documents get no
      dedicated test; 5 writers independently flagged it).
- [ ] FD handoff (user): the gen:gql verification gap — RULED 2026-07-04:
      defer to Task 13 (plans declare deliverables needing manual/live-env
      steps). FD-side root fix stays a handoff: adopt codegen client-preset
      TypedDocumentNode, which also deletes every serverFn `response as`
      cast.
- [ ] FD (observation): recurring jest-worker SIGSEGV under coverage (2nd
      occurrence, different file each time); gate re-run absorbed both.
- [ ] FD (inventory, no urgency): the ~20 legacy GitHub-side test files the
      phase-3 writers named while applying the precedence rule — the
      deliberate-cleanup queue for the Cleanup Pipeline (Task 8) / a dedicated style-migration
      plan.

From the TeamSelector.tsx + test review (2026-07-04 — verdict ~95%
adherence; setup-factory structure, assertion-literal doctrine, and mock
typing rules all followed on first live outing):

- [ ] FD handoff (user): `teams?.find((t) => …)` single-letter variable in
      TeamSelector.tsx:67 — standards say `(team) =>`.
- [x] ENGINE/standards: prop-union discriminant exemption RULED + codified
      2026-07-04 in named-constants.md — component `Props` unions may use
      raw string-literal discriminants (idiomatic React; doctrine targets
      domain values crossing module boundaries; values also in domain logic
      still use the const object).
- [x] ENGINE/standards: invalid-input cast BLESSED + codified 2026-07-04 —
      unit-testing.md (reaching defensive branches: `as unknown as T`, test
      files only) + exception note in type-assertions.md.

From the full 57-new-file diff review (2026-07-04 — sweep + 5 shapes read
closely; zero beforeEach / manual cleanup / assertion anti-patterns
anywhere; route files correctly untested; QueryKey enums used; why-comments
on query tuning trace to friction decisions):

- [x] ENGINE/standards: framework-generic stubs RULED (bless loose) +
      codified 2026-07-04 in unit-testing.md Mock Typing Rules — typing
      rules pin YOUR contracts, not the framework's; UseMutationResult-kin
      stubs may cast loosely, stub only fields the unit reads. The 3 FD
      hook tests are now conformant as written.
- [ ] FD handoff (user, ties into the gen:gql handoff): `response as { … }`
      casts in ALL serverFns, Linear and GitHub alike — systematic
      pre-standards convention, not a writer miss. TypedDocumentNode
      adoption deletes every cast.
- [ ] FD handoff (user, trivial): empty `className=""` on LinearIcon in
      LinearIssueBadge.tsx.

### Task 10: Prior-art contract field — implement phase (added 2026-07-04) — DONE 2026-07-05

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

### Task 11: Standards edits from the 3rd-party agent-navigation review (added 2026-07-04) — DONE 2026-07-05 (all four edits landed: verb vocabulary in naming.md, feature-noun top level + fractal skeleton + README-invariants in folder-structure.md, caveats as specified)

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

### Task 12: Deterministic-standards follow-through — DONE 2026-07-05 (doctor `lint-rules` note: biome useImportType/noExplicitAny or eslint equivalents missing/disabled, no-linter case, skipped on standards:false; live-fires on FD's biome.json)

The deterministic slice of the standards that ISN'T Task 8 detectors:
biome/eslint one-liners (`useImportType`, `noExplicitAny`,
`noExtraneousClass`…) enabled in the CONSUMER's lint config (lightsout
ships no npm preset — hard rule). Lightsout side: a doctor check that the
recommended rules are on (grow the doctor checklist), and keep the
lint-and-formatting.md bridge line current. FD side tracked below.

### Task 15: Traverse — cross-repo data-flow traversal (added 2026-07-05; ordered BEFORE Task 13, whose /plan skill consumes its plan mode)

Migrate the .notes/traverse-plugin prototype into the engine as CLI
commands (`lightsout traverse|build-map|map-connection`) + thin ignition
skills — NOT as markdown orchestration (the prototype's own T11 predicted
losing to the code-spine doctrine). Prototype decision log T1–T10 preserved
verbatim (connection docs are routers not documentation; machine-checkable
anchors; nodes = repo OR monorepo package; edges = process-boundary
crossings; responses are edges; worklist loop, hop agent never recurses;
scan + mechanical join; change-driven clone-free verification; output modes
are renderers over one trace). Superseding entries required for T11
(orchestration → engine code) and T12 (YAML reports → JSON via the
engine's extractJsonReport machinery).

- Phase 1 — DONE 2026-07-05: contracts (HopReport, TraceState,
  ConnectionDoc kebab→camel transform, TraverseEdgeKind shared vocabulary,
  repos registry) + runTraverse worklist loop in code (frontier/visited/
  budget, trace.json rewritten per hop, rate-limit park, resume grants a
  fresh budget window, non-repo nodes crossed mechanically without budget,
  exits routed by deterministic matchExitToEdge — 0 matches = GAP,
  ambiguity = GAP) + traverseHop prompt/builder (JSON report via
  invokeAgentWithContract: re-emit retries + rejected-output evidence free)
  + `lightsout traverse` CLI with hop-chain rendering. yaml dep bundled
  (esbuild banner createRequire shim). 4 stub-driver tests w/ real local
  git clones (loop+gaps+drift+cycle-safety, budget/resume, non-repo,
  matcher). NOT yet exercised with a live hop agent — first real outing is
  the Phase 2 build-map exercise or a hand-authored two-edge map.
- Phase 2 — DONE 2026-07-05: build-map — scanEdges prompt/builder
  (EdgeInventory contract), parallel fan-out (5 concurrent, one agent per
  node), joinInventories as pure code (exact normalization + tolerant
  fuzzy pass flagged for review; matched pairs split vs the existing map
  into new/confirmed/drifted; orphans both directions; noise bucketed
  never dropped), SHA-gated inventory freshness (ls-remote for whole
  repos, path-scoped last-commit for monorepo packages — T9), durable
  inventories pooled across runs (incremental). REVIEW GATE is join.json:
  scan step never writes docs; `build-map --author <run-id>` reads the
  human-culled join back and authors docs with code-verified anchors +
  last-verified-sha, applies confirmed/drifted repairs, regenerates
  INDEX.md. Full-cycle test proves re-running the join doubles as the
  verification sweep (authored doc → confirmed). Suite 103/103. Live agent
  outing still pending (first real exercise: two adjacent FD-adjacent
  nodes).
- Phase 3 — DONE 2026-07-05: verifyConnectionAnchors as pure code (per
  anchor: ls-remote sha gate → skip; else grep at path → ok, repo-wide →
  drifted, nowhere → missing; --repair advances shas and repoints drifted
  anchors; missing only ever reported — never auto-deleted).
  `map-connection verify [ids] [--repair]` + `map-connection draft --run
  <traverse-id>` (gaps with concrete exits → drafts/ scaffolds, invisible
  to the map reader until a human fills the to-side and moves them up).
  renderTrace: diagram (Mermaid skeleton derived from crossed docs, hops
  annotate) / doc (section per hop) / plan (per-repo change surface +
  schema gates — Task 13's input) — all mechanical from trace.json.
  Ignition skills /traverse + /build-map added to the plugin (zero logic).
  Suite 106/106.
- First live exercise: build-map on real adjacent nodes; the join must
  land edges with both anchors on real lines (per prototype MIGRATION).
  PARTIAL 2026-07-05 on FD (widget + backend-api + web-app):
  - REST validated end-to-end live: widget→backend-api paired 2 edges
    (/events/feedback, /widget/config) with code-verified anchors on both
    sides. The scan→join→review-gate loop works on real repos for REST.
  - Fixes shaken out live: shared-clone race (in-flight dedupe in
    ensureNodeWorkspace + dead-partial-clone self-heal); intra-node
    producer↔consumer self-loops collapse to noise not orphan-both
    (joinInventories) — confirmed on the 3-node run (message-bus: 0
    orphans, folded to noise).
  - DECIDED 2026-07-05, blocks web-app until built — the GRAPHQL ALTITUDE MISMATCH: adding web-app
    produced 67 orphansOut (every GraphQL operation — signIn,
    createProject, findAllProjects, …) that never pair with backend's
    single inbound /graphql. The client names N operations; the server
    exposes one multiplexed transport. The join pairs on (kind, matchKey)
    and assumes symmetric keys, so the whole web-app data plane is
    unmapped. Not a bug — a scanner-contract decision the live run forced.
    Resolved → option B; see MULTIPLEXED EDGES below (the next build task).
- Connections dir + repos.yaml location: DONE 2026-07-05 — central-first
  via `traverse.connections` config / `--connections`; accepts local dirs,
  git URLs, and folders inside repos (`org/repo/src/connections`, `.git/`
  and `//` delimiter forms); git sources auto-clone/refresh into the
  shared workspace; author/repair output names the clone to commit from.

- PR MODE (queued 2026-07-05 — the unattended-map follow-up): today the
  review gate is hand-culling join.json; for a central map repo the gate
  should be a PULL REQUEST. A scheduled job scans (SHA-gated, so nightly
  runs are nearly free), joins, authors the new docs on a BRANCH of the
  map repo, and opens a PR — T14's review still happens, as a normal PR
  review; the map repo's CI runs `map-connection verify` as its check.
  With `verify --repair` already cron-able, this makes the whole map loop
  unattended except the approve button.
  Prereq: the first live outing validates scan quality; don't automate
  authoring before the join has proven trustworthy on real repos.
  Refinements to carry when picked up (2026-07-05 review):
  - Factoring — keep the engine credential/remote-write-free (it already
    is: it writes the clone and names it, never touches the remote).
    Engine gains ONLY `--branch <name>`: author onto a named branch of the
    clone and COMMIT it (the deterministic, testable primitive). A thin CI
    wrapper the team owns (a GH Action calling the CLI) does `git push` +
    `gh pr create` — that's where credentials, branch policy, labels, and
    reviewers live. Don't bake `gh` into the engine.
  - Semantics inversion — today: cull join.json, THEN author. PR mode:
    author everything, THEN review. Rejecting an edge stops being "delete
    a join.json line" and becomes "delete a doc file / amend the branch".
    Unattended there's no human to cull, so the PR reviewer inherits the
    full cull burden as file deletions. Land fuzzy matches as drafts/
    (quarantined) so the PR separates high-confidence from needs-review.
  - Surface orphans + gaps in the PR body ("saw these, couldn't pair") —
    only matched/newEdges author, so a missing node/edge would otherwise
    vanish silently (this run's 67 GraphQL orphans are the cautionary case).
  - reset --hard interaction — the workspace clone is force-refreshed
    (git reset --hard FETCH_HEAD) every invocation, so `--branch` MUST
    commit before yielding and the refresh must become branch-aware (never
    reset --hard over an unpushed local branch), or the next run wipes it.

- MULTIPLEXED EDGES (DECIDED 2026-07-05 — surfaced by the first live 3-node
  run; blocks web-app coverage): the join's "sighted twice, pair on
  matchKey" model assumes both ends name the same thing. GraphQL breaks it —
  the client emits N operations (signIn, createProject, …), the server
  exposes one multiplexed /graphql transport. 67/74 web-app orphansOut are
  this. NOT a GraphQL special-case: it's the general shape of any ONE
  physical channel carrying MANY logical operations — tRPC (/trpc + procs),
  WebSocket/Socket.io (one socket + event types), webhook receivers (one
  path, dispatched by event+action — FD's /github/webhook already), message
  topics (one topic, many schemas), S3 prefix (one bucket, many asset kinds
  — FD's s3-drop already). Build the general representation once; GraphQL is
  just the widest instance.
  DECISION = option B (transport edge + operations as payload). Both
  scanners emit ONE edge (kind=graphql, matchKey=/graphql); operation names
  ride as payload. Pairs 1:1 deterministically; keeps the join dumb
  string-matching (a scanner-CONTRACT change, not join logic). Rejected: (A)
  per-operation edges — invents 67 connections where one physically exists,
  ~67-doc CRUD explosion, hairball diagrams; (C) bare transport — drops what
  flows. B is the right altitude for a connection map AND better for a future
  diagram (one labelled edge, not 70 parallel CRUD hops — the noise reduction
  is a feature, per 2026-07-05 review).
  Design (settled this session):
  - Verify at the TRANSPORT level, not per-operation: the edge carries the
    two transport anchors (from = web-app graphql client; to =
    backend/…/graphql.module.ts) — cheap, stable, exactly what verify does
    today. Do NOT anchor all ~70 operations (would make every verify sweep
    ~70× heavier and re-import the weight B deletes).
  - Operations are GENERATED, GROUPED evidence — refreshed from the scan,
    never hand-maintained (else it rots on the first schema change). Group
    by resolver/domain (auth/projects/users/billing — mechanical from
    names); doc header carries operationsCount.
  - FREE bonus only B gives: the join holds BOTH lists (ops the client
    calls ∪ ops the server exposes). Diffing them = automatic contract-drift
    detection — client calls a server no longer exposes (broken/renamed
    bug), or server ops no client calls (dead). Turns the 70-wide problem
    into a verification asset.
  - Contract cost (small, general): EdgeInventory edges gain optional
    `operations` (name + type query/mutation/subscription/event); the
    ConnectionDoc gains a grouped operations section + operationsCount; the
    scanEdges prompt learns "for a multiplexed transport emit ONE edge with
    operations listed, not one edge per operation." Same field then serves
    tRPC/WebSocket/webhook/topic edges — no GraphQL-specific code.
  - Optional later refinement: promote a HANDFUL of significant operations
    (auth, billing, destructive deletes) to inline flags in the doc without
    making them edges. Not needed for v1.

### Task 13: Planning phase (added 2026-07-04 — the next pipeline frontier) — DONE 2026-07-05

Result: shipped as `lightsout plan explore|draft|grade` + the `/plan`
interactive-conductor skill (`plugin/skills/plan/SKILL.md`). Phase 1 (contracts
+ `plan explore`, deterministic fact verification) commit 1696fc7; Phase 2
(`plan draft` + code structural-lint loop, `plan grade` read-only detector +
gap-check) commit 957dfde; Phase 3 (the `/plan` skill + README) here. Standards
supplemental; grade advisory to `/implement`; prior-art cheap-half shipped,
enforcement deferred (fast-follow below). Doctrine updated: skills are
pure-relay ignition OR interactive conductor, both zero-determinism (CLAUDE.md
+ architecture.md). NOT live-tested (needs a logged-in harness) — stub-driver
+ bundled-CLI dispatch verified; the interactive `/plan` flow is human-only.
Plans + phase files at `.notes/plans/planning-phase/` (local).

DESIGN RESOLVED + PLAN DRAFTED 2026-07-05: session-conducted, engine-served
(porting the fdrop `/fdrop:orchestrator:plan` tree). Overview + 3 phase plans
at `.notes/plans/planning-phase/`. Shape: `lightsout plan explore|draft|grade`
subcommands (deterministic fact verification + code structural-lint +
agent gap-check) conducted by a `/plan` interactive-conductor skill
(Elicitation + Grill + gap-convergence in the session). Grill/grade pass done
2026-07-05 (two independent reviewers vs the real codebase: 13 findings, all
mechanical specification gaps — enum string values, lint markdown-parsing
contract, standards wiring, phased naming/glob, decisions.json schema embed,
partial-explore-failure policy, phantom clock hedge; zero unresolved
design-decision gaps → grades A). Not yet implemented.

FAST-FOLLOW (deferred from the plan, land on run evidence): plan-time prior-art
ENFORCEMENT. v1 ships only the cheap half — a plan-writer prompt instruction to
search existing exports before proposing a new symbol and record them in a
`## Prior Art` section (the searching is where the dedup value is). Deferred: the
structured contract field + a `grade` collision check reusing scan's tier-0
name-dedup + a `DuplicateSymbol` gap type + tests. Cheap to bolt on later
(reuses existing scan machinery); routes collisions through the existing
gap-convergence loop, so it adds no new interruption.

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
- **Manual/live-environment deliverables** (RULED 2026-07-04, from the
  Task 14 gen:gql gap): plans must be able to declare deliverables that
  need a step the verify env can't run (e.g. codegen against a live
  backend), so the human runs it before verify instead of the agent
  hand-writing generated output as a deviation.
- **Migrations declared at plan time** (from .notes/plan-updates): the
  plan phase must ensure DB migrations and their run commands are built in
  during planning — a specific case of the manual/live-environment
  deliverables rule above (the migration file + its `migrate` command are
  deliverables the verify env may not be able to run).
- **`packages:` authored/vetted in front-matter** (from .notes/plan-updates):
  the v0.6 plan front-matter scope already carries `packages:`; the plan
  phase should author and vet that declaration up front rather than
  leaving it to plan-body path derivation (see the scope chain in Task 1).
- **Required-files list, mechanically checked** (from .notes/plan-updates):
  the plan carries an explicit list of files the workflow existence-checks
  — the same mechanism as `deliverables:` front-matter above, framed as a
  plan-authored required-files manifest the engine verifies without reading.
- Plan quality gates: scope resolvable (packages), referenced paths exist,
  decision-level gaps surfaced (the fdrop gap-check/lint-plan skills are
  prior art).
- Placement decisions (where new code lives) belong here, not in a
  prescriptive architecture map (per Task 8 note).
- Shape TBD: `lightsout plan <request>` producing a plan draft vs a
  plan-vetting gate on `implement` (`lightsout implement --plan` validating
  before clean-slate) vs both. Design with the user before code.

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
  natural first target for the Cleanup Pipeline (Task 8) or a small lightsout-run plan.
- Phase 3 of linear-two-way-sync: first run on slimmed standards —
  its standards-friction count is the Task 5 experiment's readout.

### Task 16: Make the write-tests fan-out honor the module-boundary rule the standards already define (added 2026-07-04) — LAYERS 1+2 DONE (2026-07-05)

Layer 2 result (design upgraded at implementation time — import-graph
components instead of the package-grouping sketch below): one writer per
connected component of the import graph RESTRICTED to the changed files
(`collectImportEdges`: consumer-TS preProcessFile specifiers resolved only
against the changed set — relative directly, aliased by unique path suffix,
ambiguity/externals = no edge; `groupConnectedFiles`: deterministic
union-find; `chunkFileGroup`: >12-file pathological guard, narrated).
Package partition first; multi-file invocations carry a
boundary-coverage instruction; failures name the group; no consumer TS ⇒
one file per group (the old fan-out exactly). Live smoke (toy-calc, same
plan A/B): 4 writers/$3.61 → 1 writer/$1.63 — and it flushed out two real
engine bugs, both fixed + regression-tested: relative `--cwd` silently
killed consumer-TS resolution (createRequire needs absolute), and agents
in a git-nested consumer echo repo-root-relative report paths, doubling
file identities (now normalized via `readGitPrefix`). Suite 142/142.

Layer 1 result: `isInertSourceFile` (engine) — every top-level statement an
import / re-export / type declaration ⇒ no writer spawned, narrated with the
file list. Borrows the consumer's TypeScript (resolveConsumerTypescript,
same as the scan AST tier); no TS resolvable ⇒ no filtering (today's
behavior). Conservative by construction: plain constants, enums,
export-default, unreadable/deleted files all keep their writer. Unit test
over the classifier + stub-driver pipeline smoke (typescript symlinked into
the temp consumer repo); suite 116/116. NOT yet observed on a live consumer
run — first live datapoint will come from the next run whose diff touches a
barrel/type-only file.

The boundary rule is NOT an open question — it is already settled in two
places: the `standards/tests/unit/jest/unit-testing.md` "Module Boundary
Testing" + "Files That Must NOT Have Dedicated Tests" sections (Boundary vs
Internal classification; internals covered *through* the boundary; barrels /
type-only / pure-constant files get no dedicated test), and the writer prompt
itself (`unitTestWriter.md:30,38` — "through each module's public surface" /
"Skip … type-only files, barrels"). `testStandards` is injected into every
writer, so the writer is *told* the rule.

The gap is structural in the engine's fan-out, which fights that rule:
`sourceFiles()` (`runImplementPipeline.ts:416`) = *every* changed source file,
and the step spawns one writer per file with `changedFiles: [file]`
(`~:648-653`). Two distinct symptoms:

1. **Wasted invocations on inert files.** The writer prompt already tells it to
   skip barrels / type-only / config and report `complete` with empty
   `changedFiles` (`unitTestWriter.md:38`), so these don't *fail* — they burn a
   whole writer invocation to no-op (and, when a writer does write a barrel
   test anyway, produce the implementation-coupled noise this task exists to
   kill).
2. **Internal-through-boundary can't be expressed in the first pass.** A
   per-file writer for `common/utils/x.ts` is handed *only* that file, so it
   can't "test through the module's public surface" — it doesn't hold the
   surface file. It either writes a dedicated internal test (coupling to
   internals) or skips and leaves `x.ts` uncovered → the per-file coverage gate
   fails → the retry at `~:932` hands the writer the *whole* `sourceFiles()`
   set, which finally covers through the boundary. Correct, but only after a
   wasted first pass + a gate-failure round-trip.

Fix in two layers — different difficulty, ship independently. Note the
Boundary/Internal *classification* is consumer-specific (the jest table is
FD's) and the engine must NOT build a boundary detector — it genuinely can't
generically: `module-api.md` point 5 says internal subfolders keep their own
`index.ts`, so "nearest ancestor with a barrel" stops at the internal barrel,
not the feature boundary. Grouping ≠ classifying: the engine groups, the agent
(which has the injected standard) classifies within.

**Layer 1 — deterministic inert-file filter (ship first; generic, safe).**
Before fan-out, read each changed source file (cheap, no agent) and drop the
*provably logic-free* ones — barrel (`export … from` / `export *` only) and
type-only (`type` / `interface` / `export type` only, comments stripped) — from
the write-tests target set, and exempt them from the per-file coverage
requirement (nothing to cover). One pure classifier fn, **conservative: skip
only when certain there is no executable statement** (a constant file with an
env-var fallback has logic → stays). False negatives reproduce today's
behavior (safe); false positives must never happen. Matches the standard's
"Files That Must NOT Have Dedicated Tests" list exactly. "Has no executable
code" is a language property, not a consumer architecture rule — so this stays
born-generic. Kills symptom 1 outright.

**Layer 2 — package-grouped fan-out (harder; do after Layer 1, on evidence).**
Group the (filtered) changed files by `packageOf(file)` — the one boundary the
engine truly knows (`manifest.packages` already computed) — and spawn one
writer per package-group (batched across `testWriterConcurrency`), told: "these
files in package P changed; test each module through its public surface, cover
internals transitively, inert files get no test." The writer now holds a
boundary and its internals together, so it routes internal coverage to the
boundary *in the first pass* — no gate-failure round-trip. Non-monorepo = one
group (accept reduced parallelism; cap group size with a per-file fallback
above the cap, or defer finer intra-package grouping behind *config* — never a
hard-coded layout). The **per-file coverage gate stays exactly as the
backstop** — this is what makes an imperfect grouping *safe*: worst case is a
wasted round-trip, never wrong coverage.

- Keep git-truth changed files as the *scope* — this changes which files earn
  a dedicated writer and how they're grouped, not what counts as changed.
- Acceptance (Layer 1): a changed barrel / type-only file no longer spawns a
  writer and is not held to per-file coverage; a constant-with-logic file still
  does; a behavioral module still gets covered. Pure unit test over the
  classifier + a stub-driver smoke on a barrel-only change.
- Acceptance (Layer 2): a monorepo change fans out one writer per package; a
  changed internal's coverage lands in the first pass via its boundary writer.
  Stub-driver smoke proving per-package grouping + a live smoke on
  `fixtures/toy-calc`; report honestly what was not live-tested.

### Task 17: Refactor early-exit — stop re-asking an agent that already declined (added 2026-07-05, from a live consumer run) — DONE (2026-07-05)

Result: two consecutive no-change passes over an IDENTICAL gating cluster
set escalate immediately (tracked per loop, reset by any pass that changes
files — a shrinking set is progress and keeps the full pass budget); the
escalation text reports the true pass count. Stub tests: identical decline
⇒ 2 invocations, never 3; a pass that silently shrinks the gating set still
earns the next pass. Suite 117/117.

The refactor loop runs up to 3 passes while gating scan findings persist.
Live case: the agent declined the same (then-false-positive) finding three
times with the same friction rationale — passes 2 and 3 were predictable
no-ops costing ~13 min / ~$4 before escalation. Now that escalations carry
the agent's friction account (db133a7), the loop has what it needs to stop
earlier:

- Early-exit rule: two consecutive passes that BOTH report complete with
  zero changed files over an IDENTICAL gating cluster set ⇒ escalate
  immediately (don't spend the third pass). One repeat is still required —
  a single no-change pass can be a legitimate "scanner will clear next
  scan" boundary case, and the second pass proves the disagreement stable.
- Keep maxRefactorPasses as the outer cap; the early exit only shortens the
  losing path, never extends it.
- Escalation message unchanged (findings + agent rationale, per db133a7).
- Acceptance: stub-driver test — refactorer declines twice with identical
  gating set ⇒ escalated after pass 2 with both passes' evidence; a pass
  that CHANGES the gating set (partial fix) still earns the next pass.

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
