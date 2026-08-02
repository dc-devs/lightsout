# CLI

The engine behind the Claude Code skills is a standalone CLI. No npm — the
committed bundle in the repo is the tool:

```sh
git clone git@github.com:dc-devs/lightsout.git
alias lightsout="node $(pwd)/lightsout/plugin/dist/cli.mjs"
```

Requires Node 20+ and a logged-in coding agent CLI:
[Claude Code](https://code.claude.com) (`claude`) and/or Codex (`codex`).
lightsout never handles credentials or API keys — it drives your installed
CLI, and usage bills to the subscription that CLI is already logged into.

## Try it on the bundled fixture

`fixtures/toy-calc` is a tiny consumer repo with one unimplemented plan:

```sh
cd lightsout/fixtures/toy-calc
node ../../plugin/dist/cli.mjs implement --plan plans/power.md --cwd .
```

Watch the pipeline run, then inspect `src/`, `test/`, and
`.lightsout/runs/<id>/manifest.json`. Reset the fixture with
`git checkout -- .` to run it again.

## Commands

| Command | Purpose |
|---|---|
| `lightsout implement --plan <path> [--overview <path>] [--packages <a,b>] [--cwd <path>] [--skip-refactor]` | Run the pipeline on a plan (optionally with an overview plan as context and a package-scope override) |
| `lightsout resume --run <id> [--cwd <path>]` | Continue a parked/failed/crashed run from its last incomplete step |
| `lightsout status [--cwd <path>]` | List runs and their states |
| `lightsout doctor [--cwd <path>]` | Read-only audit of the repo against every assumption the engine and standards make — config validity, harness binary, gitignored run state, scoped-gate script coverage, Jest mock-cleanup flags, generated paths, gate binaries. Each warn prints the exact fix; the doctor never edits anything (repo-wide changes like `clearMocks: true` are yours to apply and verify). Exit 1 only on a hard fail. |
| `lightsout scan [--cwd <path>] [--path <subdir>] [--all] [--baseline]` | Read-only structural detector suite: duplicate export names (synonym-aware; conversion opposites like `hexToRgb`/`rgbToHex` and component+route pairs are exempt), token-level clones (jscpd; floor tunable via config `scan.minCloneTokens`, default 50), functions with identical bodies after identifier normalization (uses the repo's own TypeScript — resolved from the root or any workspace package), size thresholds from the standards' numeric tables, one-export-per-file/structure lint (framework dot-suffixes like `.model`/`.dto` count as matching filenames), dead-export candidates. Test files are exempt from duplication tiers — assertion literals are contract-pinning, not copy-paste. `--baseline` writes `lightsout.scan-baseline.json` at the repo root — the explicit act of accepting the current findings as existing debt; **commit it** (it's the reviewable debt ledger, like `phpstan-baseline.neon`). With a baseline present, scans report only NEW findings; `--all` shows everything, `--baseline` again refreshes the ledger. Plain scans never write it. Typed findings persist to `.lightsout/scan.json` (the remediation pipeline's work-list). Always exits 0 — it reports, gates decide. |
| `lightsout refactor [--cwd <path>]` | Standalone findings burn-down pipeline: frozen worklist, detector×area batches, gate-kind fix routing, declines as first-class outcomes, park/resume |
| `lightsout plan verify-facts --name <n> [--cwd <path>]` | Planning stage 1: the conducting session explores in-context and authors `.lightsout/plans/<n>/facts.json` (`{ request, areas }`); this subcommand — no agent — **deterministically verifies** every claimed path/script on disk and stamps the verification block into it. Usually driven by the `/plan` skill, not run by hand. |
| `lightsout plan draft --name <n> [--scope single\|phased] [--plans <dir>] [--cwd <path>]` | Planning stage 2: a plan-writer agent authors `plan.md` from the verified facts + the session's `decisions.json`; a code structural-lint loop re-drafts until the plan is structurally clean. Writes to `plansDir` (committed plan output). |
| `lightsout plan grade --name <n> [--plans <dir>] [--cwd <path>]` | Planning stage 3: read-only detector — deterministic structural re-check + a gap-check agent → `.lightsout/plans/<n>/grade.json` with a typed `passed` verdict (A only when structure is clean AND no decision-gaps remain). The `/plan` skill reads this to converge; the grade is advisory to `/implement`. |
| `lightsout friction [--cwd <path>]` | Show accumulated friction reports from agents |
| `lightsout improve --engine <lightsout-repo> [--cwd <path>]` | Run the self-improvement loop (below) |

Exit code `0` = run passed. Non-zero with state `paused-rate-limit` or
`escalated` in the output means the run is waiting for the rate window or for
you — not broken.

## The self-improvement loop

Every agent reports *friction* — moments the plan, its instructions, the
standards, or the environment fought it — and *decisions* — choices it had to
make where the input was silent — even on successful runs. Both accumulate in
`.lightsout/friction.jsonl` (a recurring decision means something upstream
should have settled it). `lightsout improve` feeds the aggregate plus the
agent prompt files to a maintainer agent that turns *systemic* patterns into
minimal prompt edits in the engine's worktree. The loop proposes; a human
reviews the diff and ships.
