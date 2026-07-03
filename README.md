# lightsout

> Lights-out manufacturing: a factory so reliable it runs with the lights off.

**lightsout** is a deterministic engine for coding agents. It does not make
your agent smarter — it makes your agent *accountable*: mechanical gates,
typed contracts, resumable run state, and a supervisor for the exception path.
Hand it a plan; it drives your own installed coding agent (Claude Code or
Codex) through implement → test → refactor with real verification between
every step, and leaves a truthful audit trail on disk.

**Status: pre-alpha.** Design and decision log: [docs/architecture.md](docs/architecture.md).

## How a run works

```
lightsout run --plan plans/feature.md

  clean-slate gate      repo must be green before any agent runs
  implement             feature-executor agent works from your plan
  verify                your check + test commands; exit codes, not claims
  write-tests           one test-writer agent per changed source file, 5 in parallel
  verify                … + coverage gate
  refactor              refactor agent loops (≤3 passes) until a pass changes nothing
  verify                … + coverage gate
  format                your formatter runs once; gates re-verify after

  → verified diff in your worktree + manifest in .lightsout/runs/<id>/
```

Changed files flow step to step through the run manifest: after every work
step the agent's typed report is merged with a git snapshot of the worktree
(agents report what they changed; git reports what *actually* changed), and
the merged list is what the next role receives. An implement step that
changes nothing fails instead of passing vacuously. Only JS/TS-family files
earn agent turns (test writers, refactor review) — everything else is still
tracked and gated, but never costs a model call.

Every gate command the engine runs is logged to
`.lightsout/runs/<id>/commands.jsonl` — step, group, command, exit code,
duration, plus an output tail on failure — so passing gates leave evidence
too. The CLI prints the fully resolved config at launch and streams progress
live (steps, gate results, agent reports, elapsed time), and the manifest
snapshots the config permanently so every run records which settings
produced it.

Failures retry mechanically, then a read-only supervisor agent decides:
retry with guidance, or escalate to you. Hitting your subscription's rate
limit *parks* the run (`paused-rate-limit`) — `lightsout resume` continues it
from the exact step it stopped at.

## Prerequisites

- Node 20+
- A logged-in coding agent CLI: [Claude Code](https://code.claude.com)
  (`claude`) and/or Codex (`codex`). **lightsout never handles credentials or
  API keys** — it drives your installed CLI, and usage bills to the
  subscription that CLI is already logged into.

## Install

No npm. The committed bundle in the repo is the tool:

```sh
git clone git@github.com:dc-devs/lightsout.git
alias lightsout="node $(pwd)/lightsout/dist/cli.mjs"
```

## Quick start (bundled fixture)

`fixtures/toy-calc` is a tiny consumer repo with one unimplemented plan:

```sh
cd lightsout/fixtures/toy-calc
node ../../dist/cli.mjs run --plan plans/power.md --cwd .
```

Watch the pipeline run (an agent implements `power`, another writes its tests,
gates verify each stage), then inspect `src/`, `test/`, and
`.lightsout/runs/<id>/manifest.json`. Reset the fixture with
`git checkout -- fixtures/toy-calc` to run it again.

## Use in your repo

Add `lightsout.config.json` at the repo root:

```json
{
	"scripts": {
		"check": "pnpm typecheck",
		"testUnit": "pnpm test",
		"testCoverage": "pnpm test:coverage"
	},
	"standards": [".lightsout/style-card.md"],
	"testStandards": [".lightsout/style-card.md"]
}
```

| Field | Required | Purpose |
|---|---|---|
| `scripts.check` | yes | Type/lint gate — full shell command, run per verify step |
| `scripts.testUnit` | yes | Test gate — full shell command |
| `scripts.testCoverage` | yes | Coverage gate — a full shell command (your command owns the threshold), or the literal `false` to opt out. On by default: silence is not accepted, skipping the strongest gate must be a decision. Runs at clean-slate and every verify after tests exist. |
| `scripts.generate` | no | Opt-in codegen (e.g. `prisma generate`), run once **before** every gate set — gates verify, generate mutates, and parallel package gates must never race a generator. Red exit fails the gate set. |
| `scripts.build` | no | Opt-in build gate, run last in every verify step |
| `scripts.format` | no | Opt-in formatter, run once at the very end of the pipeline; gates re-verify afterwards |
| `generated` | no | Path prefixes of generated output (e.g. a Prisma client dir). Real files in your diff, but excluded from changed-file attribution — they never earn agent turns; the source that generates them is the change. |
| `packageScripts` | no | Monorepo mode — see below |
| `packagesDir` | no | Workspace packages directory for monorepo mode (default `packages`) |
| `timeouts.agentMinutes` | no | Ceiling for working agents (executor, test writers, refactorer). Default 60. A hit ceiling is a recorded step failure the run resumes from — never a crash. |
| `timeouts.supervisorMinutes` | no | Ceiling for the read-only supervisor. Default 15. |

### Monorepos

Whole-repo gates on a monorepo mean an unrelated red package blocks every
run, and the coverage bar applies to the entire repo. `packageScripts` fixes
both: command templates that run once per affected package, in parallel, with
`{package}` replaced by that package's `package.json` name:

```json
{
	"packageScripts": {
		"check": "pnpm --filter {package} typecheck",
		"testUnit": "pnpm --filter {package} test:unit",
		"testCoverage": "pnpm --filter {package} test:coverage"
	}
}
```

Every `packageScripts` command must contain `{package}` — one without it
would run identically for every package and belongs in `scripts.*` instead
(config validation rejects it).

The run's **package scope** resolves through a four-tier chain, so
`/implement plan.md` needs nothing extra:

1. `--packages backend-api,shared` on the CLI — explicit override
2. Plan front-matter — precise and authoritative when present:

   ```markdown
   ---
   packages:
     - backend-api
   ---
   # Plan: ...
   ```

3. **Derived from the plan body** — concrete `packages/<name>/` paths the
   plan references become the scope (recorded in the manifest and the run
   report as `plan-paths`, so a derived scope is never mistaken for a
   declared one). This is why plans from tools that know nothing about
   lightsout — plan mode output, hand-written plans — just work. Safe in
   both directions: a package mentioned only as context merely runs extra
   gates, and a missed one is caught by scope expansion below.
4. Hard error — the plan names no packages at all, which usually means it's
   too vague to implement anyway.

After the implement step, changed files are the truth: the scope widens
automatically when the agent touches a package the scope missed (never
shrinks). Files outside `packagesDir` re-activate the whole-repo `scripts.*`
as a "root group". Tip: use a dependents filter in the templates
(`pnpm --filter ...{package}`) to also verify packages that depend on the
changed ones — the blast radius lives in your template, not in the engine.
| `standards` | no | Standards for code-writing agents. **Unspecified = the engine's bundled JS/TS defaults load** (announced in the run header). `false` = explicitly none. An array = exactly these: repo-relative markdown files (missing = hard error) and/or the token `lightsout:code-defaults` to stack the bundled defaults with repo extras. |
| `testStandards` | no | Same, for the test-writer agent (token: `lightsout:test-defaults`) |
| `driver` | no | `claude-code` (default) or `codex` |
| `model` | no | Model override passed through to the harness |
| `permissionMode` | no | Harness permission mode for agents (default `acceptEdits`) |

Recommended `.gitignore` entries: commit the config and standards, not run
state —

```
.lightsout/runs/
.lightsout/friction.jsonl
```

Then: write a plan (a markdown file stating goal, files, and what's out of
scope) and run it. The repo must be green first — the clean-slate gate refuses
a broken baseline. For phased work, pass the high-level plan with
`--overview` — it rides along as context while the phase plan stays
authoritative for scope.

## CLI

| Command | Purpose |
|---|---|
| `lightsout run --plan <path> [--overview <path>] [--packages <a,b>] [--cwd <path>] [--skip-refactor]` | Run the pipeline on a plan (optionally with an overview plan as context and a package-scope override) |
| `lightsout resume --run <id> [--cwd <path>]` | Continue a parked/failed/crashed run from its last incomplete step |
| `lightsout status [--cwd <path>]` | List runs and their states |
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
should have settled it). `lightsout improve` feeds the
aggregate plus the agent prompt files to a maintainer agent that turns
*systemic* patterns into minimal prompt edits in the engine's worktree.
The loop proposes; a human reviews the diff and ships.

## Claude Code plugin (experimental)

The repo doubles as a plugin whose `/implement` skill is the ignition for the
bundled engine (no logic in the skill — all of it lives in the engine):

```
/plugin marketplace add /path/to/lightsout
```

The plugin flow has not been exercised end-to-end yet — the CLI is the proven
path today.

## Development

```sh
pnpm install
pnpm check    # typecheck all packages
pnpm test     # engine test suite (node:test, stub drivers only — no agent calls, no network)
pnpm bundle   # rebuild dist/cli.mjs — the bundle is COMMITTED; rebuild + commit with any source change
```

Tests live in `packages/engine/tests/`, are bundled by esbuild (the engine
imports agent prompts as markdown text, which plain `node --test` cannot
load), and run against real temp git repos with stubbed drivers.

Conventions and settled decisions: [CLAUDE.md](CLAUDE.md) and the decision log
in [docs/architecture.md](docs/architecture.md).

## License

[MIT](LICENSE)
