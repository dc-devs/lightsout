# lightsout

> Lights-out manufacturing: a factory so reliable it runs with the lights off.

**lightsout** is a deterministic engine for coding agents. It does not make
your agent smarter — it makes your agent *accountable*: mechanical gates,
typed contracts, resumable run state, and a supervisor for the exception path.
Hand it a plan; it drives your own installed coding agent (Claude Code or
Codex) through implement → test → refactor with real verification between
every step, and leaves a truthful audit trail on disk.

**Status: pre-alpha.** Design and decision log: [docs/architecture.md](docs/architecture.md).

## Why

Frontier models already write good code on the median run. What breaks
unattended work is the *bad* run — and everything here exists for that run:

- **Verification can't be sweet-talked.** Agents report; subprocesses decide.
  Every gate is your own repo's commands and an exit code the model can't
  influence. An agent claiming "tests pass" counts for nothing until the
  engine has run them.
- **Failures are honest and specific.** Agent output is validated against
  typed contracts at every boundary. A failed run tells you exactly what's
  missing and why — in one live run, the executor reported the precise
  deliverable it couldn't produce and the exact command that would produce
  it, which became config (`agentCommands`) instead of a mystery.
- **Everything leaves evidence.** Every gate command lands in
  `commands.jsonl` with exit code and duration; agent output that fails its
  contract is persisted verbatim; the manifest snapshots the config that
  produced the run. A green gate that left no trace is indistinguishable
  from one that never ran — so no gate runs without a trace.
- **Crashes, rate limits, and flakes are states, not disasters.** Run state
  lives on disk, never in a context window: kill the process, hit your
  subscription window, catch a flaky test-worker crash — `resume` re-enters
  at the exact step. Red gates get one mechanical re-run before the verdict,
  because one flaky failure is evidence of nothing.
- **Changed-file truth is double-entry.** What agents report is merged with
  what git actually observed; work an agent forgot to mention still gets
  tests, review, and gates.
- **Your harness, your subscription, zero credentials.** The engine drives
  the coding-agent CLI you're already logged into. No API keys, no
  third-party auth, nothing to leak.
- **It improves from its own runs.** Agents report friction — where the
  plan, prompts, standards, or environment fought them — and the aggregate
  drives prompt and standards fixes. The first consumer's phase-one plan
  surfaced five engine improvements before it shipped.

What lightsout deliberately is *not*: a smarter agent, a prompt library, or
an orchestrator persona. Scaffolding that constrains the model depreciates
with every model release; scaffolding that verifies it appreciates.

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

Agents are watchable while they work: each invocation's harness event
stream is teed to `.lightsout/runs/<id>/agents/stream-*.jsonl` (the full
chat as on-disk evidence — `tail -f` it for raw live access) and every tool
call is narrated in the progress stream as it happens
(`implement · Edit: src/app/services/linear-sync.ts`), so a 30-minute agent
step is a running commentary, not a silent clock. Watching is read-only by
design: course-correction belongs to gates, the supervisor, and escalation —
never to a human whispering mid-step.

One run at a time per repo: `run` and `resume` take a lock
(`.lightsout/lock.json`) before touching anything, so a second concurrent
invocation fails fast instead of fighting the first over the worktree. A lock
left by a crashed process is detected by pid and stolen automatically, and
`lightsout status` flags a `running` run with no live process behind it as
crashed-but-resumable.

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
alias lightsout="node $(pwd)/lightsout/plugin/dist/cli.mjs"
```

## Quick start (bundled fixture)

`fixtures/toy-calc` is a tiny consumer repo with one unimplemented plan:

```sh
cd lightsout/fixtures/toy-calc
node ../../plugin/dist/cli.mjs run --plan plans/power.md --cwd .
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
| `scripts.testUnit` | yes | Test gate — full shell command. Runs in gate sets without a coverage run (e.g. the post-implement verify, where new code has no tests yet). |
| `scripts.testCoverage` | yes | Coverage gate — a full shell command (your command owns the threshold), or the literal `false` to opt out. On by default: silence is not accepted, skipping the strongest gate must be a decision. Runs at clean-slate and every verify after tests exist, and **replaces** `testUnit` in those gate sets — the command must run the unit tests (every mainstream runner's coverage mode does), so the same suites never run twice back-to-back. |
| `scripts.generate` | no | Opt-in codegen (e.g. `prisma generate`), run once **before** every gate set — gates verify, generate mutates, and parallel package gates must never race a generator. Red exit fails the gate set. |
| `scripts.build` | no | Opt-in build gate, run last in every verify step |
| `scripts.format` | no | Opt-in formatter, run once at the very end of the pipeline; gates re-verify afterwards |
| `generated` | no | Path prefixes of generated output (e.g. a Prisma client dir). Real files in your diff, but excluded from changed-file attribution — they never earn agent turns; the source that generates them is the change. |
| `agentCommands` | no | Command prefixes the implementing agent may run (prefix match, arguments allowed) — for deliverables only a command can produce, e.g. `"pnpm --filter api run prisma:migrate:dev:name"`. Injected into the executor's task as an explicit grant list and relayed to the harness's allowed-tools mechanism. Agents may never verify with these — the engine runs all gates itself. |
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
.lightsout/lock.json
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
pnpm bundle   # rebuild plugin/dist/cli.mjs — the bundle is COMMITTED; rebuild + commit with any source change
```

Tests live in `packages/engine/tests/`, are bundled by esbuild (the engine
imports agent prompts as markdown text, which plain `node --test` cannot
load), and run against real temp git repos with stubbed drivers.

Conventions and settled decisions: [CLAUDE.md](CLAUDE.md) and the decision log
in [docs/architecture.md](docs/architecture.md).

## License

[MIT](LICENSE)
