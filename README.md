# lightsout

**Stop the slop. Make every decision up front, then walk away.**

Lightsout takes a finished plan and runs it through a gated software factory. Your coding agent implements, tests, and refactors autonomously. Your standards guide how the code is written, while deterministic gates decide whether the work passes.

**Humans make the decisions. Agents execute them. Your commands decide when the work is done.**

**Status: pre-alpha.**

## Why

Coding agents are smart. But without direction, they optimize for the task in front of them, not the long-term shape of the repository.

They solve the immediate problem and move on. They miss an existing helper and write another one. They introduce a second pattern beside an existing one. They copy whatever patterns are nearby, including the shortcuts and bad decisions already hiding in the repo.

Each change may work. The tests may pass. But over time, the repository accumulates duplicate logic, competing abstractions, inconsistent styles, and multiple ways to solve the same problem.

Worse, that degradation compounds. Once a weak pattern enters the codebase, future agents encounter it as precedent and repeat it. The mess becomes part of the context.

Lightsout makes repository quality part of the work, not something left for a human to clean up afterward:

- **Search before writing.** Agents look for existing and similar code before introducing something new.
- **Standards at every step.** Your style guide and architecture rules are injected throughout planning, implementation, testing, and refactoring.
- **Refactoring is mandatory.** Every implementation gets a dedicated cleanup pass before the run can finish.

Completing the task is not enough. Agents should leave the repository better than they found it.

## The lightsout approach

- **Humans decide. Agents execute.** Before implementation begins, you and the planning agent agree on a complete design spec: scope, architecture, files touched, tradeoffs, constraints, and acceptance criteria. Once every decision is settled, the implementation agent follows the plan without guessing or inventing the design as it goes.
- **Makes code standards a first-class concern.** Your style guide and architecture rules are injected into planning, implementation, testing, and refactoring. The agent follows the standards you defined instead of copying whatever patterns it happens to find in the repository.
- **Improves the codebase with every run.** During planning, agents search for existing helpers and similar implementations, then identify where shared abstractions can replace duplicated logic. Every run ends with a mandatory refactoring pass.
- **Puts deterministic gates between every stage.** Lightsout runs your tests, lint, type checks, and coverage commands directly instead of asking an agent to verify its own work. It is faster, cheaper, and more reliable than agent-only orchestration. If a gate fails, the pipeline stops.
- **Makes every run auditable.** All gate results, agent conversations, decisions, and costs are recorded in the run manifest. A successful run does not just claim it passed. It can prove it.

## Quick start

1. **Install lightsout.**

   In Claude Code:

   ```text
   /plugin marketplace add dc-devs/lightsout
   ```

2. **Define your standards and gate commands.**

Add a `lightsout.config.json` to the repository with your code standards and validation commands. Only the `gates` commands are mandatory — everything else is optional with sensible defaults. Leave `standardsPackages` out and lightsout uses the standards package it ships with. See [docs/configuration.md](docs/configuration.md) for all available options.

```json
{
  "gates": {
    "check": "pnpm check",
    "test": "pnpm test:unit",
    "test-coverage": "pnpm test:coverage",
    "test-e2e": "pnpm test:e2e",
    "build": "pnpm bundle"
  }
}
```

3. **Design before you build.**

Use `/brainstorm` to pressure-test a rough idea, explore alternative approaches and tradeoffs, and agree on a clear direction before any code is written. The final design is saved and handed to /plan.

4. **Turn the design into an executable spec.**

Use `/plan` to explore the codebase and settle the scope, architecture, files touched, constraints, edge cases, and acceptance criteria. The plan is graded until nothing is left for the implementation agent to guess, invent, or decide on its own.

5. **Hand the spec to the factory.**

Use `/implement`, then walk away. The implementation agent follows the finished spec, writes the code and tests, and performs a mandatory refactoring pass. Deterministic gates verify every stage, and the complete run is recorded in .lightsout/runs/<id>/.

## Commands

### /brainstorm

Design before you build. `/brainstorm` turns a rough idea into a clear direction through dialogue. It asks questions, explores alternative approaches, explains the tradeoffs, and recommends a path forward.

Once the direction is settled, it saves two things — the design write-up, and the list of decisions that were settled, in a form `/plan` honors — and hands them to `/plan`. For small, obvious changes, it can also exit directly to implementation.

```text
/brainstorm add rate limiting to the public API
```

### /plan

Turn the design into an executable spec. `/plan` explores the codebase, searches for existing helpers and similar implementations, and works through the scope, architecture, files touched, constraints, edge cases, abstractions, and acceptance criteria.

The plan is graded and revised until nothing is left for the implementation agent to guess, invent, or decide on its own.

When a plan starts from a `/brainstorm` hand-off, the decisions already settled there are carried straight into the plan rather than asked again; a settled decision is re-opened only when exploring the code turns up a concrete conflict.

[![How /plan turns a request into an implementation-ready spec](assets/plan-workflow-light.svg)](assets/plan-workflow-light.svg)


Start from the notes `/brainstorm` saved:

```text
/plan .lightsout/plans/rate-limiting/notes.md
```

Or start from a plain description:

```text
/plan add rate limiting to the public API
```

### /implement

Hand the finished spec to the factory. `/implement` follows the plan, writes the code and tests, and performs a mandatory refactoring pass.

Deterministic gates run between every stage. If a test, lint, type-check, or coverage command fails, the pipeline stops. When the run succeeds, the complete record is written to `.lightsout/runs/<id>/`.

[![How /implement turns the spec into verified code](assets/implement-workflow-light.svg)](assets/implement-workflow-light.svg)

```text
/implement .lightsout/plans/rate-limiting/plan.md
```

### /refactor

Turn existing technical debt into a gated refactoring run. `/refactor` runs the standards checks for duplicated logic, oversized files, structural violations, the shape of your test files, where folders and files sit and what they are called, and opportunities to replace repeated code with shared abstractions.

By default, it checks the entire repository. Use --path to target a specific directory and --max-batches to limit how many refactoring batches it completes. Agents fix each batch, and your deterministic gates verify the changes before the run continues.

Before each batch, an agent also reads the judgment-only rules against that batch's files and hands its findings to the fixing agent as advice. Use --code-checks to skip that review and run against the deterministic checks alone — faster and cheaper when the findings are mechanical.

Verified changes remain in your worktree for review and commit, and the complete record is written to `.lightsout/runs/<id>/`.

```text
/refactor --path <subdir> --max-batches <n>
```

### Working with your standards

Three commands answer questions about the standards themselves, rather than about your code.

`lightsout standards-check` reports what your repository breaks today. It has two halves and runs both by default: the checks your rules ship as code, and an agent reading the rules no code can check. `--code-checks` runs only the first, `--agent-review` only the second. The agent's findings are always advice — they never fail a run. A run including the code checks writes its report to `.lightsout/standards-check.json`; a review-only run prints and writes nothing, leaving that file as the last real check left it.

`lightsout standards-validate` runs every check in a standards package against its own pass and fail fixtures. It is the gate to run while writing a rule: a check that lets its fail fixture through catches nothing, and one that flags its pass fixture cries wolf.

`lightsout standards-health` reports on the rules themselves — which are checked by code, which are left to judgment, and how often agents declined each one's findings, with the reasons they gave. The counts come from the refactor runs recorded in `.lightsout/runs/`, so a repository with no history still gets the coverage half.

```text
lightsout standards-check --code-checks
lightsout standards-validate
lightsout standards-health
```

## Documentation

- [Configuration](docs/configuration.md)
- [Monorepos](docs/monorepos.md)

## License

[MIT](LICENSE)
