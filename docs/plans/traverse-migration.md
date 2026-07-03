# Traverse migration plan

Migrate the traverse prototype (`.notes/traverse-plugin/` — cross-repo
data-flow traversal over connection docs) into lightsout as engine code.
Read `.notes/traverse-plugin/README.md` for what the system is and
`.notes/traverse-plugin/docs/traverse/decisions.md` (T1–T14) for why it is
shaped this way. T1–T10 are settled domain design and port unchanged; this
plan executes T11's own predicted outcome (orchestration moves to a code
spine; skills reduce to ignition).

## Verdict and rationale (settled in review, 2026-07-03)

- **The orchestration becomes engine code.** The traverse loop (frontier +
  visited set + hop budget + state-after-every-hop) is isomorphic to the
  implement pipeline; prompt-run loops fail exactly the way v1 failed. The
  mechanical work (join, index, anchor/SHA checks, Mermaid skeleton) is pure
  string/git work where agent judgment adds only risk. A corrupted map
  outlives any one run.
- **It lives in this repo.** The no-npm hard rule makes cross-repo reuse of
  drivers/contracts/engine impossible; `traverse --mode plan` feeds
  `lightsout run --plan` (map → trace → plan → implement, one plugin);
  `runPromptImprovement` is precedent for a second engine flow.
- **The mechanism ships, the map does not** (born generic). Connection docs,
  the repo registry, and node stubs are consumer data, located by config.
  The prototype's example docs become fixture material only.

## Decisions record

To be entered into the architecture decision log as they land:

| Decision | Choice | Why |
|---|---|---|
| Config | Separate `traverse.config.json`, upward search from cwd | `lightsout.config.json` requires implement-pipeline scripts a traverse-only user has no business defining; traverse's cwd is not a consumer repo |
| Agent boundary | JSON reports (supersedes T12's YAML surface, keeps its substance) | Reuses `extractJsonReport` + `invokeAgentWithContract`; zero new dependencies |
| Connection-doc frontmatter | Flattened keys (`from-anchor-path`, `from-anchor-pattern`, …), hand-rolled parser | Nested YAML would force a yaml dependency; flat keys parse with the `readPlanPackages` approach and diff cleanly |
| Repo registry | `repos.json` in the map dir | Machine data, engine-parsed, zod-validated — parse, don't cast |
| Routing index | Derived at runtime by globbing the map dir; no INDEX.md artifact | INDEX.md existed so a skill could do one cheap read; code scans the dir — one less thing to regenerate and drift |
| Node granularity | Registration-time decision, never made by a traversal | Unregistered exits are GAPs (a human registers, choosing whole-repo or `{repo, path}`); a whole-repo node that is secretly multi-service traces *correctly but coarsely* (semantics are process-based per T5) and self-surfaces via gaps and join self-edges |
| Node splits | Renaming `from`/`to` across docs + registry; anchors untouched | Anchors are repo-root-relative from day one — the repo is a storage detail, so splits are cheap. Document the invariant; a `map split-node` command waits until needed twice |
| Workspace | Engine-owned `~/.lightsout/repos/` cache; depth-1 clones; refresh = `fetch --depth 1` + `reset --hard FETCH_HEAD` | The engine needs clones it may hard-reset; sibling dirs are humans' working checkouts. Evidence (`scanned_sha`, `last-verified-sha`, `file:line`) is only meaningful against known origin state. The cache is disposable and shared across cwds |
| Local-checkout traversal | Deferred opt-in (`localPath` / `--local`), manifest records sha + dirty flag | A trace built on uncommitted state must never masquerade as verified |
| Run state | `.lightsout/traverse/runs/<id>/` in the cwd; `paused-review` added to the shared `RunStatus` | One brand, one state root; only traverse flows emit the new status |
| Review gate (T14) | Park as `paused-review`; engine writes `join.json` + human-readable `review.md`; human edits `join.json`; `build-map --resume` validates and authors | Honest, diff-able, resumable; survives hundreds of edges |
| Join self-edges | New classification bucket: matching out/in sightings within one node → "likely monorepo, consider splitting" | Blob-node mis-granularity becomes a deterministic detection instead of orphan noise |
| map-connection skill | Verify-repair folds into build-map's join (rerunning the join against existing docs IS the verification sweep); single-edge drafting deferred | No third orchestration flow until the gap-to-doc path is exercised |
| Live validation | Runs in parallel with the build, owned by the human (prototype as-is on two real adjacent nodes); not a blocking phase | Falsifies domain design (anchors, match_keys, two-sighting join) on real code; findings adjust contracts, which stay cheap to change |

## Target layout

Existing package layering absorbs everything — no new package:

- `contracts` — `TraverseConfig`, `RepoRegistry`, `ConnectionDoc`,
  `EdgeInventory`, `HopReport`, `JoinResult`, `TraceManifest` (+ `RunStatus`
  gains `paused-review`)
- `agents` — `prompts/traverseHop.md`, `prompts/scanEdges.md` + invocation
  builders (JSON output contracts)
- `engine` — `runTraverse`, `runBuildMap`, map loading, clone management,
  the join, renderers
- `cli` — `traverse`, `build-map` subcommands
- `plugin` — thin ignition skills `/traverse`, `/build-map` beside
  `implement`; rebuild the committed `plugin/dist/cli.mjs`
- `fixtures/toy-map/` — two tiny local git repos with one wire edge between
  them + a map dir; the stub-e2e consumer fixture

## Data shapes (reference)

`traverse.config.json`:

```jsonc
{
	"map": "./connections",              // dir holding docs, nodes/, repos.json
	"workspace": "~/.lightsout/repos",   // default
	"driver": "claude-code",             // + model / permissionMode / timeouts
	"budget": 12                          // default hop budget
}
```

`repos.json` (in the map dir): `node name → clone URL | { repo, path }`.
Packages sharing a repo share one clone; scan/hop agents receive `path` as
`scope`. Staleness: whole-repo node = origin HEAD moved; package node = last
commit touching its path moved.

Connection doc: flattened frontmatter (`from`, `to`, `type`,
`from-anchor-path`, `from-anchor-pattern`, `to-anchor-path`,
`to-anchor-pattern`, `schema`, `last-verified-sha`, `additional-context`)
+ 2–4 line body. Docs are routers, not documentation (T1).

Trace manifest (`.lightsout/traverse/runs/<id>/manifest.json`): question,
mode, budget, frontier, visited, hops (the trace artifact), gaps, drift,
answer — persisted after every hop; resume re-enters the loop with the
saved frontier.

## Phases

Each phase lands with the standard verification: `pnpm check` + `pnpm test`
additions + a stub-driver smoke test; live verification where feasible;
honest reporting of what was not live-tested. `pnpm bundle` + commit the
bundle with any source change.

### Phase 1 — contracts + map loading

- All contracts above; `paused-review` in `RunStatus`.
- `loadTraverseConfig` (upward search), `readRepoRegistry`,
  `readConnectionDoc` (flattened-frontmatter parser),
  `buildConnectionIndex` (glob the map dir → routing table).
- Tests: config discovery; registry forms (URL and `{repo, path}`);
  frontmatter round-trip; malformed doc rejected at the boundary; index
  derivation.

### Phase 2 — `runTraverse`

- `traverseHop.md` prompt (ported from the prototype agent; JSON report;
  add the unscoped-monorepo line: wire calls between co-located deployables
  are exits like any other) + `buildTraverseHopInvocation`.
- `ensureRepoClone` (clone/refresh via `runCommand`; one clone per repo,
  many nodes).
- The worklist loop: pop frontier → resolve doc (non-repo nodes via
  `nodes/` stubs) → ensure clone → spawn hop → validate report → route
  exits (doc match → enqueue with reason; no match → GAP, never guess) →
  persist manifest → repeat. Budget counters, visited set, parallel
  fan-out for independent repos (test-writer batching pattern), rate-limit
  parking, resume, lock (reuse the run-lock functions, parameterized path).
- Renderers: Mermaid skeleton + cited hop chain in code; one agent call per
  mode (`answer|bug|doc|diagram|plan`) writes prose over the trace, never
  from memory. Drift/gap reporting after every run.
- CLI: `lightsout traverse "<question>" [--mode --start --budget --cwd]`.
- Tests (stub drivers): budget exhaustion stops with frontier intact and
  resumable; visited set terminates cycles; unmapped exit → gap recorded,
  no traversal past it; anchor drift recorded; rate-limit → park; resume
  continues from saved frontier; malformed hop report rejected + retried.

### Phase 3 — `runBuildMap`

- `scanEdges.md` prompt + builder (JSON inventory).
- Scan orchestration: resolve nodes, SHA-gated inventory reuse
  (`.lightsout/traverse/inventories/<node>.json` — durable, makes runs
  incremental), `--rescan` override, parallel scan fan-out.
- `joinInventories` as a pure function: match_key normalization, fuzzy
  tolerance (flagged), buckets `matched | confirmed | drifted |
  orphans_out | orphans_in | noise | self_edges`.
- Park as `paused-review`: write `join.json` + `review.md`; resume
  validates the edited `join.json`, authors docs mechanically from the
  joined sightings (frontmatter 1:1, summary from payload notes,
  `additional-context` left empty rather than invented), applies
  `confirmed` sha updates and `drifted` repairs (`possibly-dead` over
  silent deletion).
- Orphan resolution (org code search) stays an optional agent wave.
- CLI: `lightsout build-map <nodes…|all> [--rescan]`,
  `lightsout build-map --resume <id>`.
- Tests: table-driven join classifier (including self-edges and fuzzy
  cases — the highest-value test surface in the migration); inventory
  staleness gating; park → edit → resume round trip; authoring golden
  files against `fixtures/toy-map`.

### Phase 4 — plugin ignition + records

- Thin `/traverse` and `/build-map` skills (parse phrasing → CLI
  invocation; zero logic in markdown). `pnpm bundle`, commit the bundle.
- `fixtures/toy-map/` finalized as the stub-e2e fixture.
- `docs/architecture.md`: traverse section; decision log gains T1–T10
  (verbatim), T11 superseded, T12–T14 amended, plus the table above.
- Delete `.notes/traverse-plugin/` once parity is confirmed.
- Final live verification: the human's validation scenario rerun through
  the code path end-to-end.

## Parallel track — live validation (human-owned, non-blocking)

Install the prototype from `.notes/traverse-plugin/` as a local plugin,
pick two adjacent real nodes, fill `repos.yaml`, run `/build-map` on them.
Check: the join yields the expected edge with both anchors on real lines.
Then one short `/traverse` across the edge. Findings (match_key noise,
anchor brittleness, hop-report quality) feed back into Phase 1/2 contracts
and prompts.

## Deferred (recorded, not scoped)

- `--local` / `localPath` traversal of a local checkout (sha + dirty flag
  honesty rules above).
- `map split-node` command (manual steps documented until needed twice).
- Single-edge doc drafting from a traversal gap (`map-connection`'s other
  half).
- Golden-question regression suite once the map has real edges (T-log
  called for 3–5 known traces).
