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
  write-tests           test-writer agent covers the changed files
  verify                …
  refactor              refactor agent reviews the diff (zero changes = success)
  verify                …

  → verified diff in your worktree + manifest in .lightsout/runs/<id>/
```

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
		"testUnit": "pnpm test"
	},
	"standards": [".lightsout/style-card.md"],
	"testStandards": [".lightsout/style-card.md"]
}
```

| Field | Required | Purpose |
|---|---|---|
| `scripts.check` | yes | Type/lint gate — full shell command, run per verify step |
| `scripts.testUnit` | yes | Test gate — full shell command |
| `standards` | no | Markdown files inlined as binding rules for code-writing agents. A declared-but-missing file is a hard error. |
| `testStandards` | no | Same, for the test-writer agent |
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
a broken baseline.

## CLI

| Command | Purpose |
|---|---|
| `lightsout run --plan <path> [--cwd <path>] [--skip-refactor]` | Run the pipeline on a plan |
| `lightsout resume --run <id> [--cwd <path>]` | Continue a parked/failed/crashed run from its last incomplete step |
| `lightsout status [--cwd <path>]` | List runs and their states |
| `lightsout friction [--cwd <path>]` | Show accumulated friction reports from agents |
| `lightsout improve --engine <lightsout-repo> [--cwd <path>]` | Run the self-improvement loop (below) |

Exit code `0` = run passed. Non-zero with state `paused-rate-limit` or
`escalated` in the output means the run is waiting for the rate window or for
you — not broken.

## The self-improvement loop

Every agent reports *friction* — moments the plan, its instructions, the
standards, or the environment fought it — even on successful runs. Friction
accumulates in `.lightsout/friction.jsonl`. `lightsout improve` feeds the
aggregate plus the agent prompt files to a maintainer agent that turns
*systemic* patterns into minimal prompt edits in the engine's worktree.
The loop proposes; a human reviews the diff and ships.

## Claude Code plugin (experimental)

The repo doubles as a plugin whose `/implement` skill is a doorbell for the
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
pnpm bundle   # rebuild dist/cli.mjs — the bundle is COMMITTED; rebuild + commit with any source change
```

Conventions and settled decisions: [CLAUDE.md](CLAUDE.md) and the decision log
in [docs/architecture.md](docs/architecture.md).

## License

[MIT](LICENSE)
