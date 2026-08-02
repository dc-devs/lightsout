# lightsout

> Stop the slop. Settle the plan, then walk away. Your coding agent
> implements, tests, and refactors autonomously — while deterministic gates
> enforce your standards at every step: your tests, your lint, your style
> guide, your coverage thresholds.

*Named for lights-out manufacturing—factories designed to run unattended.*

**Status: pre-alpha.**

## Why

AI coding agents are good at the task in front of them. They are less
reliable at preserving the shape of the repository around it. With limited
context, they miss existing helpers, duplicate logic, invent new
conventions, and repeat whatever patterns they encounter — even bad ones.
Each change works and passes its tests, but the codebase accumulates
conflicting abstractions, scattered utilities, and multiple answers to the
same problem — making the repo harder for both humans and agents to
understand, change, and trust.

## What lightsout does

- **Clean code is a first-class citizen.** Before writing anything new,
  agents are directed to find existing code that already does the job.
  Refactoring is built into every run.
- **Your standards ride along at every step.** Style guide and architecture
  rules are injected into plan, implement, test, and refactor — enforced,
  not suggested.
- **Deterministic gates between every step.** An agent can claim its code
  passes tests, lint, and coverage. The engine never takes its word — after
  every step it runs your commands itself, and a failure stops the run.
- **Humans are in the loop where it matters.** Brainstorm, plan, and get
  grilled on that plan until every decision is settled. Then hand the
  mechanical part to the agent.
- **Evidence, not claims.** Every gate command, agent conversation, and cost
  lands on disk in the run's manifest. A green run can prove it.

## What a run looks like

```
$ lightsout implement --plan plans/power.md

[+0:00] step clean-slate — attempt 1
[+0:00] gate [root] check: exit 0            ← the repo must be green before any agent runs
[+0:00] gate [root] testUnit: exit 0
[+0:00] step implement — attempt 1 · invoking agent (ceiling 60m)
[+0:32]   implement · usage: in 11 · out 1.6k · cache-read 159.1k · $0.28
[+0:32] step implement: agent report complete — 2 changed file(s)
                                             ← what the agent reports is merged with
                                               what git actually saw change
[+0:32] gate [root] check: exit 0            ← gates re-run after every step;
[+0:32] gate [root] testUnit: exit 0           a red exit stops the run
[+0:32] step write-tests — attempt 1 · 1 group(s), up to 5 writers in parallel
[+0:59] write-tests: src/power.js — complete
[+0:59] step refactor — pass 1/3             ← a scan feeds findings on the changed
[+1:25] refactor pass 1: no changes — loop complete    files; loops until clean

run       5df09112 · PASSED
wall      1m 25s
tokens    in 111 · out 4.9k · cache-read 357.2k (88%)
cost      $0.77 API-equivalent · 3 invocations

│ step               │ tries │   time │ agents │  out │  cost │ files │
│ ✓ implement        │     1 │    32s │      1 │ 1.6k │ $0.28 │     2 │
│ ✓ write-tests      │     1 │    27s │      1 │ 1.7k │ $0.26 │     1 │
│ ✓ refactor         │     1 │    26s │      1 │ 1.7k │ $0.23 │     0 │

evidence  .lightsout/runs/5df09112…/          ← every gate command, agent conversation,
                                               and cost, on disk
```

## A plan a fresh agent can execute

The test of a finished plan: an agent with zero conversation history —
a fresh context window, nothing but the plan file — implements exactly
what it outlines. No guessing, no filling gaps, no surprises in the PR.

`/plan` gets you there by interviewing you until every decision an
implementer would otherwise make alone is settled: goal, scope, files
touched, design choices, project constraints. Then it grades the plan
and won't call it ready until nothing is left open.

That is why implementation can run unattended.

## Quick start

In Claude Code:

```
/plugin marketplace add dc-devs/lightsout
```

Then, in the repo where you want to work:

1. Add a `lightsout.config.json` with your three commands:

   ```json
   {
   	"scripts": {
   		"check": "pnpm typecheck",
   		"testUnit": "pnpm test",
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

## How a run works

Agents do the work. Gates decide if it stands. Git decides what actually
changed. If something breaks, the run stops, says why, and can resume from
the same step. Everything a run does is saved to disk.

## What it is not

Not a smarter agent, not a prompt library, not an orchestrator persona.
Scaffolding that constrains the model depreciates with every model release;
scaffolding that verifies it appreciates.

## Going deeper

- [docs/configuration.md](docs/configuration.md) — full config reference
- [docs/monorepos.md](docs/monorepos.md) — scoped gates for workspaces
- [docs/cli.md](docs/cli.md) — every CLI command

## Development

```sh
pnpm install
pnpm check    # typecheck all packages
pnpm test     # engine test suite (stub drivers only — no agent calls, no network)
pnpm bundle   # rebuild plugin/dist/cli.mjs — the bundle is COMMITTED; rebuild + commit with any source change
```

## License

[MIT](LICENSE)
