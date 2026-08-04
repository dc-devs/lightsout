# Configuration

All configuration lives in one file at the repo root: `lightsout.config.json`.

The minimal, complete config:

```json
{
	"scripts": {
		"check": "pnpm typecheck",
		"testUnit": "pnpm test",
		"testCoverage": "pnpm test:coverage"
	}
}
```

That's enough: the engine's bundled JS/TS standards load by default (base
docs always; React/TanStack docs join automatically when the run's packages
use those frameworks). Add a `standards` array only to bring your own docs —
include the token `lightsout:code-defaults` to stack the bundled ones
alongside them.

## Field reference

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
| `packageScripts` | no | Monorepo mode — see [monorepos.md](monorepos.md) |
| `packagesDir` | no | Workspace packages directory for monorepo mode (default `packages`) |
| `plansDir` | no | Where the planning phase writes the committed `plan.md` deliverable (default `.claude/plans`). Resolved flag (`--plans`) → config → default, then absolutized. Transient planning workspace state (`facts.json`, `decisions.json`, `grade.json`) always lives under gitignored `.lightsout/plans/<name>/`. |
| `timeouts.agentMinutes` | no | Ceiling for working agents (executor, test writers, refactorer). Default 60. A hit ceiling is a recorded step failure the run resumes from — never a crash. |
| `timeouts.supervisorMinutes` | no | Ceiling for the read-only supervisor. Default 15. |
| `standards` | no | Standards for code-writing agents. **Unspecified = the engine's bundled JS/TS defaults load** (announced in the run header). `false` = explicitly none. An array = exactly these: repo-relative markdown files (missing = hard error) and/or the token `lightsout:code-defaults` to stack the bundled defaults with repo extras. |
| `testStandards` | no | Same, for the test-writer agent (token: `lightsout:test-defaults`) |
| `standardsChannels` | no | Framework channels of the bundled defaults. The base docs always apply; React/Preact and TanStack docs ride along **only when the run's scoped packages actually depend on that framework** (detected from their `package.json` — announced in the run log). Set an array to replace detection (`[]` = base only). A terraform package never pays the React-docs token tax. |
| `scan.minCloneTokens` | no | Tier-1 clone floor for `lightsout scan` (default 50) — raise for repos with a noisy short-clone tail |
| `scan.size` | no | Line-cap overrides for the size detector — defaults `{ "file": 250, "tsxFile": 300, "function": 80, "hook": 160, "component": 200 }`; any subset, e.g. `{ "tsxFile": 350 }`. The same numbers appear in the standards docs, so agents are told the caps the scanner enforces. File caps gate runs; function/hook/component caps go to the refactor agent as judgment items (fix unless a documented exemption applies) and never block. |
| `driver` | no | `claude-code` (default) or `codex` |
| `model` | no | Model override passed through to the harness |
| `commands` | no | Per-command harness overrides — optional `implement` / `refactor` / `improve` / `plan` entries (`plan` covers draft/dedup/grade), each with an optional `driver` and/or `model` for just that command. Unknown keys inside this block are a hard config error, never silently ignored. |
| `permissionMode` | no | Harness permission mode for agents (default `acceptEdits`) |

## Maximal example

Every optional field set:

```json
{
	"driver": "claude-code",
	"model": "opus",
	"commands": {
		"improve": { "driver": "codex", "model": "gpt-5.2" },
		"plan": { "model": "haiku" }
	},
	"permissionMode": "acceptEdits",
	"scripts": {
		"check": "pnpm typecheck",
		"testUnit": "pnpm test",
		"testCoverage": "pnpm test:coverage",
		"generate": "pnpm prisma:generate",
		"build": "pnpm build",
		"format": "pnpm format:write"
	},
	"timeouts": { "agentMinutes": 60, "supervisorMinutes": 15 },
	"agentCommands": ["pnpm --filter api run prisma:migrate:dev:name"],
	"generated": ["src/generated/", "src/schema.gql"],
	"packagesDir": "packages",
	"packageScripts": {
		"check": "pnpm --filter {package} typecheck",
		"testUnit": "pnpm --filter {package} test:unit",
		"testCoverage": "pnpm --filter {package} test:coverage",
		"build": "pnpm --filter {package} build"
	},
	"standards": ["lightsout:code-defaults", "docs/our-extra-rules.md"],
	"testStandards": ["lightsout:test-defaults"],
	"standardsChannels": ["react"],
	"scan": {
		"minCloneTokens": 70,
		"size": { "file": 250, "tsxFile": 300, "function": 80, "hook": 160, "component": 200 }
	}
}
```

## Per-command resolution

Each command resolves its harness in one pass: its `commands` entry wins, the
global `driver`/`model` are the fallback, and `claude-code` is the final driver
default. The global `model` falls through only to a command that resolves to
the global driver — a model name is meaningful only to its own harness, so a
per-command driver override never inherits the other harness's model. `resume`
always keeps the run manifest's recorded driver, regardless of the config.

## Recommended .gitignore

Commit the config and standards, not run state:

```
.lightsout/runs/
.lightsout/friction.jsonl
.lightsout/lock.json
```
