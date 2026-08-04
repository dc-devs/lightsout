# lightsout

**Stop the slop. Make every decision up front, then walk away.**

Lightsout turns a finished plan into a gated software factory. Your coding agent implements, tests, and refactors autonomously, while deterministic gates enforce your repository’s standards: tests, lint, architecture rules, style guide, and coverage thresholds.

**Humans make the decisions. Agents execute them. Your commands decide when the work is done.**

Named for lights-out manufacturing: factories designed to run unattended.

**Status: pre-alpha.**

## Why

Coding agents are smart. But without direction, they optimize for the task in front of them, not the long-term shape of the repository.

They solve the immediate problem and move on. They miss an existing helper and write another one. They introduce a new pattern beside an established one. They copy whatever code is nearby, including the shortcuts and bad decisions already hiding in the repo.

Each change may work. The tests may pass. But over time, the repository accumulates duplicate logic, competing abstractions, inconsistent styles, and multiple ways to solve the same problem.

Worse, that degradation compounds. Once a weak pattern enters the codebase, future agents encounter it as precedent and repeat it. The mess becomes part of the context.

Lightsout makes repository quality part of the work, not something left for a human to clean up afterward:

- **Search before writing.** Agents look for existing and similar code before introducing something new.
- **Standards at every step.** Your style guide and architecture rules are injected throughout planning, implementation, testing, and refactoring.
- **Refactoring is mandatory.** Every implementation gets a dedicated cleanup pass before the run can finish.

Completing the task is not enough. Agents should leave the repository better than they found it.

## The lightsout approach

* **Improves the codebase with every run.** During planning, agents search for existing helpers and similar implementations, then identify where shared abstractions can replace duplicated logic. Every run ends with a mandatory refactoring pass.
* **Makes code standards a first-class concern.** Your style guide and architecture rules are injected into planning, implementation, testing, and refactoring. The agent follows the standards you defined instead of copying whatever patterns it happens to find in the repository.
* **Puts deterministic gates between every stage.** Lightsout runs your tests, lint, type checks, and coverage commands directly instead of asking an agent to verify its own work. It is faster, cheaper, and more reliable than agent-only orchestration. If a gate fails, the pipeline stops.
* **Humans decide. Agents execute.** Before implementation begins, you and the planning agent agree on a complete design spec: scope, architecture, files touched, tradeoffs, constraints, and acceptance criteria. Once every decision is settled, the implementation agent follows the plan without guessing or inventing the design as it goes.
* **Makes every run auditable.** Every gate result, agent conversation, decision, and cost is written to the run manifest. A successful run does not just claim it passed. It can prove it.


## Quick start

In Claude Code:

```
/plugin marketplace add dc-devs/lightsout
```

Then, in the repo where you want to work:

1. Add a `lightsout.config.json` with your three commands (more details in
   [Config](#config) below):

   ```json
   {
    "standards": ["/standards/code", "docs/our-extra-rules.md"],
    "testStandards": ["/standards/tests"],
   	"scripts": {
   		"check": "pnpm check",
   		"testUnit": "pnpm test:unit",
   		"testCoverage": "pnpm test:coverage"
   	}
   }
   ```

2. `/brainstorm` an idea into a direction, `/plan` it until every decision
   is settled, then:

3. `/implement` — and walk away. The pipeline runs gated, unattended, and
   leaves its evidence in `.lightsout/runs/<id>/`.

Prefer a terminal? The CLI behind the skills works standalone — see
[docs/cli.md](docs/cli.md).

## Commands

### /brainstorm

Shape a rough idea into a buildable direction. A dialogue: it checks whether
you have one idea or several, offers two or three ways to build it with
trade-offs and a recommendation, and converges on a design stated in plain
words. Exits to "just build it," or writes notes and hands them to `/plan`.

```
/brainstorm add rate limiting to the public API
```

### /plan

Turn a direction into a plan an agent can implement without guessing. It
explores the codebase, interviews you until every open decision is settled,
drafts the plan, and grades it — not ready until nothing is left open.

```
/plan .lightsout/plans/rate-limiting/notes.md
```

### /implement

Run the pipeline on a finished plan. An agent implements, tests are written,
the code is refactored — with your gates between every step. Walk away; the
run leaves its evidence in `.lightsout/runs/<id>/`.

```
/implement .claude/plans/rate-limiting/plan.md
```

## Config

One file at the repo root: `lightsout.config.json`. Only `scripts` is
required — everything else has a sensible default. Full detail on every
field lives in [docs/configuration.md](docs/configuration.md).

| Field | Required | What it does |
|---|---|---|
| `scripts.check` | yes | Type/lint gate — full shell command, run at every verify step |
| `scripts.testUnit` | yes | Test gate — full shell command |
| `scripts.testCoverage` | yes | Coverage gate — a shell command, or the literal `false` to opt out. Skipping the strongest gate must be a decision, not an accident. |
| `scripts.generate` | no | Opt-in codegen (e.g. `prisma generate`), run once before every gate set |
| `scripts.build` | no | Opt-in build gate, run last in every verify step |
| `scripts.format` | no | Opt-in formatter, run once at the very end of the pipeline |
| `driver` | no | Which harness runs the agents: `claude-code` (default) or `codex` |
| `model` | no | Model override passed through to the harness |
| `commands` | no | Per-command harness overrides — `implement` / `refactor` / `improve` / `plan` entries, each with its own `driver` and/or `model`. Unknown keys here are a hard error, never silently ignored. |
| `permissionMode` | no | Harness permission mode for agents (default `acceptEdits`) |
| `timeouts.agentMinutes` | no | Ceiling for working agents, in minutes (default 60). A hit ceiling is a resumable step failure, never a crash. |
| `timeouts.supervisorMinutes` | no | Ceiling for the read-only supervisor (default 15) |
| `agentCommands` | no | Command prefixes the implementing agent may run, for deliverables only a command can produce. Never for verifying — the engine runs all gates itself. |
| `generated` | no | Path prefixes of generated output — real files in the diff, but excluded from changed-file attribution |
| `packageScripts` | no | Monorepo mode: gate command templates run per affected package, with `{package}` replaced by the package name — see [docs/monorepos.md](docs/monorepos.md) |
| `packagesDir` | no | Workspace packages directory for monorepo mode (default `packages`) |
| `plansDir` | no | Where the planning phase writes the committed `plan.md` (default `.claude/plans`) |
| `standards` | no | Standards for code-writing agents. Unspecified = the bundled JS/TS defaults; `false` = none; an array = exactly these markdown files, with the token `lightsout:code-defaults` to stack the bundled ones alongside yours. |
| `testStandards` | no | Same, for the test-writer agent (token: `lightsout:test-defaults`) |
| `standardsChannels` | no | Framework channels of the bundled standards (e.g. `react`). Unspecified = detected from the run's packages; an array replaces detection (`[]` = base docs only). |
| `scan.minCloneTokens` | no | Minimum clone size for a `lightsout scan` duplication finding (default 50) |
| `scan.size` | no | Line-cap overrides for the size detector (defaults: file 250, tsxFile 300, function 80, hook 160, component 200) |

Every optional field set:

```jsonc
{
  /* harness, model, and permission setup */
  "driver": "claude-code",
	"model": "opus",
  "permissionMode": "bypassPermissions",
	"commands": {
    "plan": { "driver": "claude-code", "model": "claude-opus-5" },
		"implement": { "driver": "claude-code", "model": "claude-sonnet-5" }
	},
  
  /* define standards */
  "standards": ["/standards/code", "docs/our-extra-rules.md"],
  "testStandards": ["/standards/tests"],
  "standardsChannels": ["base"],
	
  /* define scripts */
  "scripts": {
		"check": "pnpm check",
		"testUnit": "pnpm test:unit",
		"testCoverage": "pnpm test:unit:coverage",
		"generate": "pnpm prisma:generate",
		"build": "pnpm build",
		"format": "pnpm format:write"
	},
	
  /* define monorepo scripts */
  "packagesDir": "packages",
	"packageScripts": {
    "check": "pnpm --filter {package} check",
		"testUnit": "pnpm --filter {package} test:unit",
		"testCoverage": "pnpm --filter {package} test:unit:coverage",
		"build": "pnpm --filter {package} build"
	},

  /* define allowed commands */
  "agentCommands": ["pnpm --filter api run prisma:migrate:dev:name"],
  
  /* define auto generated files (excluded from change tracking) */
	"generated": ["src/generated/", "src/schema.gql"],
	
  /* timeouts and scan tuning */
  "timeouts": { "agentMinutes": 60, "supervisorMinutes": 15 },
	"scan": {
		"minCloneTokens": 70,
		"size": { "file": 250, "tsxFile": 300, "function": 80, "hook": 160, "component": 200 }
	}
}
```

## License

[MIT](LICENSE)
