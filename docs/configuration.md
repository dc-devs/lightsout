# Configuration

Lightsout is configured from a single file at the root of your repository:

```text
lightsout.config.json
```

## Minimal setup

To run lightsout, define the commands it should use to verify the work:

```json
{
  "scripts": {
    "check": "pnpm check",
    "testUnit": "pnpm test:unit",
    "testCoverage": "pnpm test:unit:coverage"
  }
}
```

## Common configurations

### Use lightsout’s code standards

The minimal configuration uses lightsout’s bundled JavaScript and TypeScript standards. Framework-specific standards are added automatically when supported frameworks are detected.

```json
{
  "scripts": {
    "check": "pnpm check",
    "testUnit": "pnpm test:unit",
    "testCoverage": "pnpm test:unit:coverage"
  }
}
```

### Extend lightsout’s code standards

Keep the bundled defaults and add rules specific to your repository:

```json
{
  "standards": [
    "lightsout:code-defaults",
    "docs/architecture.md",
    "docs/code-standards.md"
  ],
  "testStandards": ["lightsout:test-defaults", "docs/test-standards.md"],
  "scripts": {
    "check": "pnpm check",
    "testUnit": "pnpm test:unit",
    "testCoverage": "pnpm test:unit:coverage"
  }
}
```

### Configure a monorepo

Use `packageScripts` to run gates only for packages affected by the current change. The `{package}` placeholder is replaced with each package name.

```json
{
  "packagesDir": "packages",
  "packageScripts": {
    "check": "pnpm --filter {package} check",
    "testUnit": "pnpm --filter {package} test:unit",
    "testCoverage": "pnpm --filter {package} test:unit:coverage",
    "build": "pnpm --filter {package} build"
  },
  "scripts": {
    "check": "pnpm check",
    "testUnit": "pnpm test:unit",
    "testCoverage": "pnpm test:unit:coverage"
  }
}
```

See [Monorepos](docs/monorepos.md) for package detection and gate-resolution details.

## How verification works

Lightsout does not ask an agent whether its work is correct. It runs your commands directly and uses their exit codes to decide whether the pipeline can continue.

At every verification stage, commands run in this order:

1. `generate`, when configured
2. `check`
3. `testUnit`
4. `testCoverage`
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

Lightsout loads its bundled JavaScript and TypeScript standards by default. The base standards always apply, while framework-specific standards for React and TanStack are added automatically when those frameworks are detected in the packages involved in the run.

To replace the bundled standards with your own, add a `standards` array:

```json
{
  "standards": ["docs/code-standards.md", "docs/architecture.md"],
  "scripts": {
    "check": "pnpm check",
    "testUnit": "pnpm test:unit",
    "testCoverage": "pnpm test:unit:coverage"
  }
}
```

To keep the Lightsout standards and add your own rules alongside them, include `lightsout:code-defaults`:

```json
{
  "standards": ["lightsout:code-defaults", "docs/our-extra-rules.md"],
  "testStandards": ["lightsout:test-defaults", "docs/test-standards.md"],
  "scripts": {
    "check": "pnpm check",
    "testUnit": "pnpm test:unit",
    "testCoverage": "pnpm test:unit:coverage"
  }
}
```

Each entry is a path relative to the root of your repository. An entry may also be a folder, in which case every Markdown file under it is loaded, including files in subfolders, in sorted path order. A folder that contains no Markdown files fails the run, exactly like a file that does not exist.

Set `standards` or `testStandards` to `false` to disable that category entirely.

## Field reference

| Field                        | Required | What it controls                                                                                                                                                                                                                                                                          |
| ---------------------------- | -------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts.check`              |      yes | The type-check and lint gate. Provide the full shell command lightsout should run at every verification stage.                                                                                                                                                                            |
| `scripts.testUnit`           |      yes | The unit-test gate. Provide the full shell command required to pass.                                                                                                                                                                                                                      |
| `scripts.testCoverage`       |      yes | The coverage gate. Provide a shell command, or set it to `false` to opt out. Skipping the strongest gate must be an explicit decision, not an accident.                                                                                                                                   |
| `scripts.generate`           |       no | An opt-in code-generation command, such as `prisma generate`. Runs once before each set of gates.                                                                                                                                                                                         |
| `scripts.build`              |       no | An opt-in build gate. Runs last during every verification stage.                                                                                                                                                                                                                          |
| `scripts.format`             |       no | An opt-in formatting command. Runs once at the end of the pipeline.                                                                                                                                                                                                                       |
| `harness`                    |       no | The default harness used to run agents. Supported values are `claude-code` and `codex`. Defaults to `claude-code`.                                                                                                                                                                        |
| `model`                      |       no | A model override passed through to the selected harness.                                                                                                                                                                                                                                  |
| `effort`                     |       no | The reasoning effort passed to the selected harness. One of `low`, `medium`, `high`, `xhigh`, or `max`. When omitted, each harness uses its own default.                                                                                                                                   |
| `commands`                   |       no | Per-command harness overrides for `plan`, `implement`, `refactor`, and `improve`. Each entry may define its own `harness`, `model`, `effort`, or any combination. A global `model` is not inherited by a command that selects a different harness; a global `effort` is, because the five levels mean the same thing everywhere. Unknown command keys are rejected rather than silently ignored. |
| `permissions`                |       no | The capability level granted to agent invocations: `write` (agents may edit files and run commands inside the workspace) or `full-access` (the harness's sandbox is bypassed entirely). Defaults to `write`. The read-only level used by the supervisor is chosen by the engine and is not settable. |
| `timeouts.agentMinutes`      |       no | The maximum runtime for a working agent, in minutes. Defaults to `60`. Reaching the limit creates a resumable step failure rather than crashing the run.                                                                                                                                  |
| `timeouts.supervisorMinutes` |       no | The maximum runtime for the read-only supervisor, in minutes. Defaults to `15`.                                                                                                                                                                                                           |
| `agentCommands`              |       no | Command prefixes that implementation agents are allowed to run when producing deliverables that cannot be created another way. These commands are never used for verification; lightsout runs all gates itself.                                                                           |
| `generated`                  |       no | Path prefixes for generated output. These remain real files in the diff but are excluded from changed-file attribution.                                                                                                                                                                   |
| `packageScripts`             |       no | Enables monorepo-aware gates. Each command template runs once per affected package, with `{package}` replaced by the package name. See [Monorepos](docs/monorepos.md).                                                                                                                    |
| `packagesDir`                |       no | The workspace packages directory used in monorepo mode. Defaults to `packages`.                                                                                                                                                                                                           |
| `plansDir`                   |       no | The directory where `/plan` writes the committed `plan.md`. Defaults to `.claude/plans`.                                                                                                                                                                                                  |
| `standards`                  |       no | Standards injected into code-writing agents. When omitted, the bundled JavaScript and TypeScript standards are used. Set to `false` to disable code standards, or provide an array of Markdown files or folders — a folder loads every `.md` file under it, recursively, in sorted path order. Include `lightsout:code-defaults` to keep the bundled standards alongside your own. |
| `testStandards`              |       no | Standards injected into the test-writing agent. The behavior matches `standards`. Use `lightsout:test-defaults` to include the bundled test standards alongside your own.                                                                                                                 |
| `standardsChannels`          |       no | Controls which framework-specific bundled standards are loaded, such as `react`. When omitted, channels are detected from the packages involved in the run. Providing an array replaces automatic detection. Use `[]` to load only the base standards.                                    |
| `scan.minCloneTokens`        |       no | The minimum clone size reported by `lightsout scan`. Defaults to `50` tokens.                                                                                                                                                                                                             |
| `scan.size`                  |       no | Overrides the line limits used by the size detector. Defaults are `file: 250`, `tsxFile: 300`, `function: 80`, `hook: 160`, and `component: 200`.                                                                                                                                         |

### Harness-neutral keys

Two rules govern the keys above, and this surface depends on both:

- A key with a neutral name must mean the same thing on every harness. A capability only one harness has never gets a neutral key, because a key that reads as portable but silently does nothing is a failure you cannot see. If such a capability is ever needed, it goes under an explicitly harness-scoped block.
- `permissions` expresses intent, not identical enforcement. On Claude Code the commands granted through `agentCommands` are enforced by the harness itself. On Codex the workspace-write sandbox already permits commands, so the grant list the engine injects into the agent's prompt is what binds.

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

  // Code and test standards
  "standards": ["standards/code", "docs/our-extra-rules.md"],
  "testStandards": ["standards/tests"],
  "standardsChannels": ["base"],

  // Repository-wide gates
  "scripts": {
    "check": "pnpm check",
    "testUnit": "pnpm test:unit",
    "testCoverage": "pnpm test:unit:coverage",
    "generate": "pnpm prisma:generate",
    "build": "pnpm build",
    "format": "pnpm format:write",
  },

  // Per-package gates for monorepos
  "packagesDir": "packages",
  "packageScripts": {
    "check": "pnpm --filter {package} check",
    "testUnit": "pnpm --filter {package} test:unit",
    "testCoverage": "pnpm --filter {package} test:unit:coverage",
    "build": "pnpm --filter {package} build",
  },

  // Where completed plans are written
  "plansDir": ".claude/plans",

  // Commands implementation agents may run
  "agentCommands": ["pnpm --filter api run prisma:migrate:dev:name"],

  // Generated files excluded from changed-file attribution
  "generated": ["src/generated/", "src/schema.gql"],

  // Agent and supervisor limits
  "timeouts": {
    "agentMinutes": 60,
    "supervisorMinutes": 15,
  },

  // Duplication and file-size detection
  "scan": {
    "minCloneTokens": 70,
    "size": {
      "file": 250,
      "tsxFile": 300,
      "function": 80,
      "hook": 160,
      "component": 200,
    },
  },
}
```

## Recommended `.gitignore`

Commit your configuration and standards. Ignore the state produced by individual runs:

```gitignore
.lightsout/runs/
.lightsout/friction.jsonl
.lightsout/lock.json
```
