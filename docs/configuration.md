# Configuration

Lightsout is configured from a single file at the root of your repository:

```text
lightsout.config.json
```

## Minimal setup

To run lightsout, define the commands it should use to verify the work:

```json
{
  "gates": {
    "check": "pnpm check",
    "test": "pnpm test:unit",
    "test-coverage": "pnpm test:unit:coverage"
  }
}
```

## Common configurations

### Use lightsout’s code standards

The minimal configuration uses lightsout’s bundled JavaScript and TypeScript standards. Framework-specific standards are added automatically when supported frameworks are detected.

```json
{
  "gates": {
    "check": "pnpm check",
    "test": "pnpm test:unit",
    "test-coverage": "pnpm test:unit:coverage"
  }
}
```

### Use your own standards

Point `standards-packages` at one or more standards packages. Each entry is the
folder holding a `lightsout-standards.json` file:

```json
{
  "standards-packages": ["standards/house-rules"],
  "gates": {
    "check": "pnpm check",
    "test": "pnpm test:unit",
    "test-coverage": "pnpm test:unit:coverage"
  }
}
```

### Configure a monorepo

Use `package-gates` to run gates only for packages affected by the current change. The `{package}` placeholder is replaced with each package name.

```json
{
  "packages-dir": "packages",
  "package-gates": {
    "check": "pnpm --filter {package} check",
    "test": "pnpm --filter {package} test:unit",
    "test-coverage": "pnpm --filter {package} test:unit:coverage",
    "build": "pnpm --filter {package} build"
  },
  "gates": {
    "check": "pnpm check",
    "test": "pnpm test:unit",
    "test-coverage": "pnpm test:unit:coverage"
  }
}
```

See [Monorepos](monorepos.md) for package detection and gate-resolution details.

## How verification works

Lightsout does not ask an agent whether its work is correct. It runs your commands directly and uses their exit codes to decide whether the pipeline can continue.

At every verification stage, commands run in this order:

1. `generate`, when configured
2. `check`
3. `test`
4. `test-coverage`
5. `build`, when configured

If any command fails, the stage fails and the pipeline stops. The agent cannot override, reinterpret, or talk its way past a failing gate.

The `format` command is different: it runs once at the end of the pipeline, after the implementation and verification stages are complete.

This separation keeps responsibilities clear:

- Agents write and refactor the code.
- Your standards define how the code should be written.
- Your gate commands decide whether the work passes.

These commands become the deterministic gates between pipeline stages. Lightsout runs them directly rather than asking an agent to verify its own work.

This is the smallest complete configuration. Everything else is optional.

## Adding your standards

Standards arrive as **standards packages**. A package is a folder holding a
`lightsout-standards.json` file, a `code/` tree of documents for the agents that
write code, and a `tests/` tree for the agent that writes tests. Every rule is a
folder inside a document: its prose, the check that enforces it when one is
possible, and the example files that prove the check works.

Lightsout ships one such package and loads it when you say nothing. Its base
documents always apply, while the framework-specific documents for React and
TanStack are added automatically when those frameworks are detected in the
packages involved in the run.

To use your own instead, list its root folder:

```json
{
  "standards-packages": ["standards/house-rules"],
  "gates": {
    "check": "pnpm check",
    "test": "pnpm test:unit",
    "test-coverage": "pnpm test:unit:coverage"
  }
}
```

Entries load in the order you list them, and each may be a path relative to the
root of your repository or an absolute path. Listing several stacks their
documents; two packages that claim the same rule id fail the run rather than
letting an override mean two things. A root with no `lightsout-standards.json`
in it fails the run too.

Set `standards-packages` to `false` to run with no standards at all.

### Commands for working with a package

`lightsout standards-validate [--package <path>]` runs every check in a package
against its own pass and fail fixtures. Without the flag it validates the
package lightsout ships. This is the gate to run while writing a rule: a check
that lets its fail fixture through catches nothing, and one that flags its pass
fixture cries wolf. Neither is visible when the package loads, and both are
exactly what an author needs told. It validates every rule regardless of
channel, because authoring covers every channel.

`lightsout standards-health` reports on the rules rather than on your code: per
rule, whether code checks it or an agent has to judge it, and how often agents
declined its findings, with the reasons they gave. The coverage half is counted
from the package's own folders, so it lands even in a repository that has never
run anything. The decline half is aggregated from the refactor runs recorded
under `.lightsout/runs/`, and reads `—` until you have some.

`lightsout standards-check` reports what your code breaks today. It runs both
halves of the check by default — the checks your rules ship as code, and an
agent reading the rules no code can check. Pass `--code-checks` for only the
first, or `--agent-review` for only the second. The agent's findings are always
advisory: they join the same reported stream, and they never fail a run. A run
that includes the code checks writes `.lightsout/standards-check.json`; a
review-only run prints and writes nothing, because that file is the machine
half's evidence and a judgment call must not overwrite it. A repository whose
harness is not installed gets a plain "agent review skipped" note rather than a
failure.

## Field reference

| Field                         | Required | What it controls                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | -------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gates.check`                 |      yes | The type-check and lint gate. Provide the full shell command lightsout should run at every verification stage.                                                                                                                                                                                                                                                                                   |
| `gates.test`                  |      yes | The fast test gate — the unit suite. `test` and `test-coverage` are two spellings of the same suite (plain and instrumented), so lightsout runs one or the other, never both.                                                                                                                                                                                                                    |
| `gates.test-coverage`         |      yes | The coverage gate. Provide a shell command, or set it to `false` to opt out. Skipping the strongest gate must be an explicit decision, not an accident. The command must run the same suite `test` runs, instrumented — lightsout substitutes it for `test`.                                                                                                                                     |
| `gates.test-*`                |       no | Any other `test-` key is a custom suite of its own — `test-e2e`, `test-integration`, `test-browser`, whatever your repo calls it. Custom suites are never substituted by coverage and run in the order written here, after the unit suite and before `build`.                                                                                                                                    |
| `gates.generate`              |       no | An opt-in code-generation command, such as `prisma generate`. Runs once before each set of gates.                                                                                                                                                                                                                                                                                                |
| `gates.build`                 |       no | An opt-in build gate. Runs last during every verification stage.                                                                                                                                                                                                                                                                                                                                 |
| `gates.format`                |       no | An opt-in formatting command. Runs once at the end of the pipeline.                                                                                                                                                                                                                                                                                                                              |
| `harness`                     |       no | The default harness used to run agents. Supported values are `claude-code` and `codex`. Defaults to `claude-code`.                                                                                                                                                                                                                                                                               |
| `model`                       |       no | A model override passed through to the selected harness.                                                                                                                                                                                                                                                                                                                                         |
| `effort`                      |       no | The reasoning effort passed to the selected harness. One of `low`, `medium`, `high`, `xhigh`, or `max`. When omitted, each harness uses its own default.                                                                                                                                                                                                                                         |
| `commands`                    |       no | Per-command harness overrides for `plan`, `implement`, `refactor`, `test-coverage-to-threshold`, and `improve`. Each entry may define its own `harness`, `model`, `effort`, or any combination. A global `model` is not inherited by a command that selects a different harness; a global `effort` is, because the five levels mean the same thing everywhere. Unknown command keys are rejected rather than silently ignored. |
| `permissions`                 |       no | The capability level granted to agent invocations: `write` (agents may edit files and run commands inside the workspace) or `full-access` (the harness's sandbox is bypassed entirely). Defaults to `write`. The read-only level used by the supervisor is chosen by the engine and is not settable.                                                                                             |
| `timeouts.agent-minutes`      |       no | The maximum runtime for a working agent, in minutes. Defaults to `60`. Reaching the limit creates a resumable step failure rather than crashing the run, and stops the harness together with every process it started — a terminate signal first, then a kill if that is ignored.                                                                                                                |
| `timeouts.supervisor-minutes` |       no | The maximum runtime for the read-only supervisor, in minutes. Defaults to `15`.                                                                                                                                                                                                                                                                                                                  |
| `agent-commands`              |       no | Command prefixes that implementation agents are allowed to run when producing deliverables that cannot be created another way. These commands are never used for verification; lightsout runs all gates itself.                                                                                                                                                                                  |
| `generated`                   |       no | Path prefixes for generated output. These remain real files in the diff but are excluded from changed-file attribution.                                                                                                                                                                                                                                                                          |
| `vendored`                    |       no | Path prefixes for third-party code the repository vendors in rather than writes, such as a shadcn/ui component folder. Excluded from the source walk exactly as `generated` is, so the standards never judge it, no test is written for it, and no refactor pass touches it. Unlike `generated`, a change inside it is still attributed — vendored code has no generating source in the repository, so editing it is the change. Excluding it from a coverage threshold is your test runner's job, not the engine's. |
| `coverage-summary-path`       |       no | Where your coverage tooling writes its JSON summary (`coverage-summary.json`, the `json-summary` reporter's output), which `lightsout test-coverage-to-threshold` reads for per-file percentages. Defaults to `coverage/coverage-summary.json` — relative to the repository root, or to each package in monorepo mode.                                                                           |
| `package-gates`               |       no | Enables monorepo-aware gates. Each command template runs once per affected package, with `{package}` replaced by the package name. See [Monorepos](monorepos.md).                                                                                                                                                                                                                                |
| `packages-dir`                |       no | The workspace packages directory used in monorepo mode. Defaults to `packages`.                                                                                                                                                                                                                                                                                                                  |
| `standards-packages`          |       no | The standards packages a run works against. When omitted, the package lightsout ships is used. Set to `false` to run with no standards at all, or provide an array of package roots — each the folder holding a `lightsout-standards.json` file, relative to your repository root or absolute. One package carries both the code and the test documents, which is why there is a single key rather than two. |
| `standards-channels`          |       no | Controls which framework-specific documents of the loaded packages are used, such as `react`. When omitted, channels are detected from the packages involved in the run. Providing an array replaces automatic detection. Use `[]` to load only the base documents.                                                                                                                              |
| `standards-checks`            |       no | Per-rule overrides for `lightsout standards-check`, keyed by rule id. A rule you do not name keeps its own default. See [Standards check rules](#standards-check-rules).                                                                                                                                                                                                                         |

### Standards check rules

Every rule the standards check enforces ships with a default severity and, where it has numbers to measure against, its own settings. `standards-checks` overrides them one rule at a time:

```jsonc
{
  "standards-checks": {
    // A severity on its own.
    "filename-mismatch": "off",
    "clone": "blocking",
    // Or an object, to change the severity, the rule's settings, or both.
    "size-file": { "settings": { "file": 300, "tsxFile": 400 } },
    "folder-census": { "severity": "blocking", "settings": { "cap": 15 } },
  },
}
```

The three severities are:

- `blocking` — a violation. It stops a run when it touches a file that run changed.
- `advisory` — reported, and handed to the refactor agent as a judgment call. Never blocks.
- `off` — not run at all. This is what you set when your own linter already enforces the rule.

Severity is the only lever a run gates on. There is no separate list of blockable rules, so the only way to stop a rule blocking is to write `advisory` or `off` for it here — an explicit line in a committed file. A mistyped rule id fails config parsing rather than silently disabling an override you believe is active.

Run `lightsout standards-check --list` to print every rule with the standards document it enforces and the state it runs at in your repo — the live answer, rather than a list here that goes stale.

### Harness-neutral keys

Two rules govern the keys above, and this surface depends on both:

- A key with a neutral name must mean the same thing on every harness. A capability only one harness has never gets a neutral key, because a key that reads as portable but silently does nothing is a failure you cannot see. If such a capability is ever needed, it goes under an explicitly harness-scoped block.
- `permissions` expresses intent, not identical enforcement. On Claude Code the commands granted through `agent-commands` are enforced by the harness itself. On Codex the workspace-write sandbox already permits commands, so the grant list the engine injects into the agent's prompt is what binds.

## Complete example

The following example shows how the optional configuration fields fit together:

```jsonc
{
  // Default harness, model, effort, and permissions
  "harness": "claude-code",
  "model": "opus",
  "effort": "high",
  "permissions": "full-access",

  // Per-command harness overrides
  "commands": {
    "plan": {
      "harness": "claude-code",
      "model": "claude-opus-5",
      "effort": "max",
    },
    "implement": {
      "harness": "claude-code",
      "model": "claude-sonnet-5",
    },
  },

  // Standards packages, and which framework documents apply
  "standards-packages": ["standards/house-rules"],
  "standards-channels": [],

  // Repository-wide gates
  "gates": {
    "check": "pnpm check",
    "test": "pnpm test:unit",
    "test-coverage": "pnpm test:unit:coverage",
    "generate": "pnpm prisma:generate",
    "build": "pnpm build",
    "format": "pnpm format:write",
  },

  // Per-package gates for monorepos
  "packages-dir": "packages",
  "package-gates": {
    "check": "pnpm --filter {package} check",
    "test": "pnpm --filter {package} test:unit",
    "test-coverage": "pnpm --filter {package} test:unit:coverage",
    "build": "pnpm --filter {package} build",
  },

  // Commands implementation agents may run
  "agent-commands": ["pnpm --filter api run prisma:migrate:dev:name"],

  // Generated files excluded from changed-file attribution
  "generated": ["src/generated/", "src/schema.gql"],

  // Third-party code the repo vendors: never checked, still attributed
  "vendored": ["src/common/components/ui/"],

  // Agent and supervisor limits
  "timeouts": {
    "agent-minutes": 60,
    "supervisor-minutes": 15,
  },

  // Per-rule standards-check overrides
  "standards-checks": {
    // Our linter already enforces this one.
    "filename-mismatch": "off",
    // Raise the clone floor without changing what a clone means for the run.
    "clone": { "settings": { "minTokens": 70 } },
    // .tsx files here carry more JSX than the default budget assumes.
    "size-file": { "settings": { "tsxFile": 400 } },
  },
}
```

## Recommended `.gitignore`

Commit your configuration and standards. Ignore the state produced by individual runs:

```gitignore
.lightsout/runs/
.lightsout/plans/
.lightsout/friction.jsonl
.lightsout/lock.json
```
