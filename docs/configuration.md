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

Point `standards-packs` at one or more standards packs. Each entry is the
folder holding a `lightsout-standards.json` file:

```json
{
  "standards-packs": ["standards/house-rules"],
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

Standards arrive as **standards packs**. A pack is a folder holding a
`lightsout-standards.json` file, a `code/` tree of documents for the agents that
write code, and a `tests/` tree for the agent that writes tests. Every rule is a
folder inside a document: its prose, the check that enforces it when one is
possible, and the example files that prove the check works.

Lightsout ships one such pack and loads it when you say nothing. Its base
documents always apply, while the framework-specific documents for React and
TanStack are added automatically when those frameworks are detected in the
packages involved in the run.

To use your own instead, list its root folder:

```json
{
  "standards-packs": ["standards/house-rules"],
  "gates": {
    "check": "pnpm check",
    "test": "pnpm test:unit",
    "test-coverage": "pnpm test:unit:coverage"
  }
}
```

Entries load in the order you list them, and each may be a path relative to the
root of your repository or an absolute path. Listing several stacks their
documents; two packs that claim the same rule id fail the run rather than
letting an override mean two things. A root with no `lightsout-standards.json`
in it fails the run too.

Set `standards-packs` to `false` to run with no standards at all.

### Commands for working with a pack

`lightsout standards-validate [--pack <path>]` runs every check in a pack
against its own pass and fail fixtures. Without the flag it validates the pack
lightsout ships. This is the gate to run while writing a rule: a check that lets
its fail fixture through catches nothing, and one that flags its pass fixture
cries wolf. Neither is visible when the pack loads, and both are exactly what an
author needs told. It validates every rule regardless of channel, because
authoring covers every channel.

A pack may also ship one `fixtures/framework-owned/<framework>/` tree per
framework — a miniature repo whose `package.json` declares that framework, so
the same carve-outs a real package earns apply. `standards-validate` runs every
checked rule against every such tree and expects silence: a rule that fires
there is judging code its framework owns, and it is named as that. The tree is
found by convention, never declared, and a pack that ships none gets a note
rather than a problem.

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

The table below lists the top-level keys. A block with keys of its own — `gates`,
`standards-checks`, `ship`, `ticket-tracker`, `queue`, `plan`, `auto-plan` and
`docs` — is documented in the
subsections beneath it.

The table is generated from the engine’s own descriptions, the same sentences the
Config page shows, so the two cannot drift apart. An edit inside the comment markers
is overwritten the next time `pnpm build:config-reference` runs.

<!-- generated:config-key-reference -->

| Field | Required | What it controls |
| --- | ---: | --- |
| `harness` | no | Harness name. Supported values are 'claude-code', 'codex', 'omp' (Oh My Pi) and 'pi' (bare upstream pi). Defaults to 'claude-code'. |
| `model` | no | Model override passed through to the selected harness. |
| `effort` | no | Reasoning effort passed through to the harness — one of `low`, `medium`, `high`, `xhigh` or `max`. Omit to take each harness's own default. |
| `permissions` | no | Harness-neutral capability level for agent invocations: `write` lets agents edit files and run commands inside the workspace, `full-access` bypasses the harness's sandbox entirely. Defaults to 'write'. `read-only` is engine-selected for the supervisor and is deliberately not settable — it would make a writing role write nothing. |
| `commands` | no | Per-command harness selection for `plan`, `implement`, `refactor`, `test-coverage-to-threshold` and `improve` (`plan` covers draft, dedup and grade; `resume` always keeps the run manifest’s recorded harness). Each entry overrides the global harness, model and effort for that command; unlisted commands use the globals. A global model is not inherited by a command that selects a different harness; a global effort is, because the five levels mean the same thing everywhere. An unknown command key is rejected rather than silently ignored. |
| `gates` | yes | Verification commands — the mechanical gates. Full shell commands, run by the engine itself; agents never run them. |
| `timeouts` | no | Agent invocation ceilings, in minutes. A hit ceiling is a recorded step failure the run can resume from — never a crash. |
| `timeouts.agent-minutes` | no | Ceiling for the working roles — executor, test writers, refactorer, fixes. Defaults to 60. Reaching it stops the harness together with every process it started — a terminate signal first, then a kill if that is ignored. |
| `timeouts.supervisor-minutes` | no | Ceiling for the read-only supervisor, which reads and rules rather than editing. Defaults to 15. |
| `agent-commands` | no | Command prefixes working agents are granted (prefix match, arguments allowed) — for plan deliverables only a command can produce, such as a migration generator. Verification commands never belong here: the engine runs all gates itself. |
| `generated` | no | Path prefixes of generated or derived files. Real files in the diff, but excluded from changed-file attribution — the source that generates them is the change. Also where a repo says its build output lands when the walk cannot guess it. |
| `vendored` | no | Path prefixes of third-party code the repo vendors in rather than writes, such as a shadcn/ui component folder. Excluded from the source walk exactly as `generated` is, so the standards never judge it, no test is written for it and no refactor pass touches it — with one difference: a vendored file IS attributed when it changes, because no source in the repo produced it. Excluding it from a coverage threshold is your test runner’s job, not the engine’s. |
| `coverage-summary-path` | no | Path to the JSON coverage summary the coverage tooling writes — the `json-summary` reporter’s `coverage-summary.json`, which `lightsout test-coverage-to-threshold` reads for per-file percentages. Defaults to `coverage/coverage-summary.json`, repo-relative in single-package repos and package-relative in monorepo mode. The file is the tool-agnostic contract, so a printed coverage table changing format never breaks a run. |
| `executor-file-limit` | no | How many source files one plan or phase may create or modify before the feature executor refuses it as out of scope. Defaults to 50. One key rather than a number per reader, so the plan lint, the scope estimate and the executor’s own stop rule agree by construction. A plan that is mostly mechanical edits raises its own allowance with a `## File Budget` section rather than moving this key; the separate ceiling on files a plan creates is fixed and cannot be raised either way. |
| `packages-dir` | no | Directory holding workspace packages, for monorepo scoped gates. Defaults to `packages`. |
| `package-gates` | no | Monorepo scoped gate templates — the per-package commands `{package}` is substituted into. Each template runs once per affected package, so a gate runs only for the packages a change touched. |
| `standards-packs` | no | Standards packs a run works against. Unspecified = the pack the plugin ships; `false` = explicitly none; an array = exactly these pack roots, each the folder holding `lightsout-standards.json`, repo-relative or absolute. One pack carries both the code and the test documents, which is why there is a single key rather than two. A root that cannot be loaded is a hard error. |
| `standards-channels` | no | Framework channels of the loaded standards packs (e.g. 'react', 'tanstack'). Unspecified = detected per run from the scoped packages' package.json dependencies; an array REPLACES detection, and an empty one means base documents only. |
| `standards-checks` | no | Per-rule severity and settings overrides for `lightsout standards-check`, keyed by rule id. A rule not named here keeps its pack’s default — silence is never a change. |
| `ship` | no | Opt-in `lightsout ship` settings: the branch ticket pattern whose `ticket` capture group becomes the result’s ticket reference, the pull request body template, the merge method, whether a passed implement run chains into ship, and an optional pre-ship command run before anything is pushed. |
| `ticket-tracker` | no | Opt-in tracker identity: which provider the engine talks to and that provider’s address and credential environment variables — a Linear team and API key, or a Jira Cloud site, project, API token and account email. Every command that reads or writes a ticket resolves it from here, so tracker identity is spelled once rather than once per command. |
| `queue` | no | Opt-in queue settings: which ticket label names each planning status, what this tracker calls each status the engine writes, which statuses count as available work, how many tickets run at once, and the per-ticket worker and question timeouts. Tracker identity lives in `ticket-tracker`, so this block holds queue behaviour only. |
| `auto-plan` | no | Opt-in auto-plan settings: whether the proposal comes before drafting, whether an approved proposal starts the build, and whether the proposal is skipped when nothing clears the escalation bar. Every key is off by default, so an absent block is the most supervised behaviour. |
| `plan` | no | Opt-in plan settings: whether plans are written as contracts with an acceptance-test ledger — a table naming the test that states each acceptance criterion — and graded by weight, spawning the reader fan-out only for the plan files that earn it, plus the counts above which a plan file is heavy. Off by default, so an absent block is exactly today’s behaviour: the same template, the same required sections, every plan file read by every lens. |
| `docs` | no | Opt-in documentation surfaces: each entry a repo-relative path and a one-line `covers` saying what that document is responsible for. Declaring the block turns on the plan-time documentation check — the plan writer is briefed on the surfaces, every implementable plan file must carry a `## Documentation` statement, and `plan grade` runs one whole-plan checker that verifies it. A repository that declares no block sees none of it: no section, no prompt text, no checker spawn. |

<!-- /generated:config-key-reference -->

### Gate keys

| Field                         | Required | What it controls                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | -------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `gates.check`                 |      yes | The type-check and lint gate. Provide the full shell command lightsout should run at every verification stage.                                                                                                                                                                                                                                                                                   |
| `gates.test`                  |      yes | The fast test gate — the unit suite. `test` and `test-coverage` are two spellings of the same suite (plain and instrumented), so lightsout runs one or the other, never both.                                                                                                                                                                                                                    |
| `gates.test-coverage`         |      yes | The coverage gate. Provide a shell command, or set it to `false` to opt out. Skipping the strongest gate must be an explicit decision, not an accident. The command must run the same suite `test` runs, instrumented — lightsout substitutes it for `test`.                                                                                                                                     |
| `gates.test-*`                |       no | Any other `test-` key is a custom suite of its own — `test-e2e`, `test-integration`, `test-browser`, whatever your repo calls it. Custom suites are never substituted by coverage and run in the order written here, after the unit suite and before `build`.                                                                                                                                    |
| `gates.generate`              |       no | An opt-in code-generation command, such as `prisma generate`. Runs once before each set of gates.                                                                                                                                                                                                                                                                                                |
| `gates.build`                 |       no | An opt-in build gate. Runs last during every verification stage.                                                                                                                                                                                                                                                                                                                                 |
| `gates.format`                |       no | An opt-in formatting command. Runs once at the end of the pipeline.                                                                                                                                                                                                                                                                                                                              |

`gates` is the one key every configuration must write. Provide full shell commands:
lightsout runs them itself and decides on their exit codes, so an agent is never asked
whether its own work passed.

### Standards check rules

Every rule the standards check enforces ships with a default severity and, where it has numbers to measure against, its own settings. `standards-checks` overrides them one rule at a time:

```jsonc
{
  "standards-checks": {
    // A severity on its own.
    "filename-mismatch": "off",
    "duplicate-code-block": "blocking",
    // Or an object, to change the severity, the rule's settings, or both.
    "size-file": { "settings": { "file": 300, "tsxFile": 400 } },
    "crowded-folder": { "severity": "blocking", "settings": { "cap": 15 } },
  },
}
```

The three severities are:

- `blocking` — a violation. It stops a run when it touches a file that run changed.
- `advisory` — reported, and handed to the refactor agent as a judgment call. Never blocks.
- `off` — not run at all. This is what you set when your own linter already enforces the rule.

Severity is the only lever a run gates on. There is no separate list of blockable rules, so the only way to stop a rule blocking is to write `advisory` or `off` for it here — an explicit line in a committed file. A mistyped rule id fails config parsing rather than silently disabling an override you believe is active.

Run `lightsout standards-check --list` to print every rule with the standards document it enforces and the state it runs at in your repo — the live answer, rather than a list here that goes stale.

#### What the default pack blocks

The pack lightsout ships blocks only what is wrong on its own terms — code that lies about its types (`no-any`, `type-assertion`, `import-type-only`, `explicit-return-type`), code nothing uses (`dead-export`, `duplicate-function-body`), a tree that breaks across filesystems (`case-collision`), doc tags git or the compiler already own (`brittle-doc-tags`), and tests that are silently weaker than they read (`test-shared-let`, `test-assert-in-hook`, `test-mock-prefix`, `test-mock-untyped`, `test-mock-wrapper-untyped`, `test-strict-equal-matcher`). Every rule about where files go, what they are called, and how many exports they hold ships `advisory`: it is still reported and still handed to the refactor agent, but a repository adopting lightsout is not blocked on day one by a layout it has not yet agreed to.

A repository that wants the strict profile promotes those rules itself — an explicit, committed list of what it holds itself to. This is the block lightsout's own repository runs:

```jsonc
{
  "standards-checks": {
    "banned-class-shapes": "blocking",
    "banned-folder-name": "blocking",
    "bare-string-union": "blocking",
    "barrel-is-only-consumer": "blocking",
    "barrel-star": "blocking",
    "barrel-under-common": "blocking",
    "casing": "blocking",
    "class-inheritance": "blocking",
    "code-in-index-file": "blocking",
    "crowded-folder": "blocking",
    "file-directly-in-common": "blocking",
    "folder-casing": "blocking",
    "import-path-alias": "blocking",
    "module-boundary": "blocking",
    "multi-export": "blocking",
    "oversized-setup-factory": "blocking",
    "placement": "blocking",
    "single-file-domain-folder": "blocking",
    "single-use-scalar": "blocking",
    "size-file": "blocking",
    "size-function": "blocking",
    "test-in-tests-folder": "blocking",
    "test-manual-mock-cleanup": "blocking",
    "test-mock-return-in-hook": "blocking",
    "test-nested-describe": "blocking",
    "test-not-beside-subject": "blocking",
    "test-size-file": "blocking",
    "test-support-in-src": "blocking",
  },
}
```

### Ship settings

| Field                 | Required | What it controls                                                                                                                                                                                                                     |
| --------------------- | -------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ship.ticket-pattern` |       no | A JavaScript regular expression source matched against the branch name. It must carry a named group `ticket`, whose value becomes the result's ticket reference; every other named group becomes a token the body template may use. Defaults to `^(?<ticket>[a-z]+-\d+)`. The same pattern is matched against a plan folder's name; a folder carrying no ticket id draws a warning and nothing more. |
| `ship.pr-body`        |       no | The pull request body template. Brace-wrapped tokens are substituted: `branch`, and one per named group of the ticket pattern. An unknown token is left exactly as written. Defaults to the bare ticket token on its own.            |
| `ship.merge-method`   |       no | How the forge merges: `merge`, `squash`, or `rebase`. Defaults to `merge`.                                                                                                                                                          |
| `ship.after-implement` |       no | When true, a passed `/implement` run chains into ship without `--ship` being typed. Defaults to `false`.                                                                                                                             |
| `ship.pre-ship`       |       no | A shell command run in the checkout before anything is pushed — the home for a repository's own pre-ship convention, such as rebuilding committed build outputs or bumping a shipped version. File changes it leaves behind are committed to the branch; a non-zero exit blocks the ship with the command's own output. No default. |

This block is where branch-to-ticket and pull-request conventions live; the
tracker connection lives in `ticket-tracker` below. Name a plan folder after
its ticket's branch, so the plan, branch, and ticket match by construction; a
folder that does not is used exactly as before, with a warning. The default
body is deliberately inert — a body that closes a ticket automatically is a
team's convention, not the engine's. The block is strict: an unknown key fails
parsing rather than silently disabling a setting you believe is on.

### Ticket tracker settings

The `ticket-tracker` block says who the engine talks to about a ticket. Every
command that reads or writes one resolves the same block, so the connection is
spelled once rather than once per command. It is discriminated by `provider`:
Linear and Jira share the provider and API-key fields, then require only the
connection fields that belong to that provider.

| Field                                      | Required | What it controls                                                                                                                                       |
| ------------------------------------------ | -------: | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ticket-tracker.provider`                  |      yes | Which tracker the engine talks to: `linear` or `jira`. This selects the rest of the block's shape.                                                      |
| `ticket-tracker.api-key-env`               |      yes | Name of the environment variable holding the Linear API key or Jira API token. The credential itself is never written to config.                       |
| `ticket-tracker.team`                      |   linear | The Linear team key, e.g. `LO`. Every Linear query is scoped to it.                                                                                     |
| `ticket-tracker.site-url`                  |     jira | HTTPS Jira Cloud origin ending in `.atlassian.net`, with no path, query, or fragment.                                                                   |
| `ticket-tracker.project`                   |     jira | Jira project key, e.g. `LO`; it scopes Jira queries and ticket identifiers.                                                                             |
| `ticket-tracker.api-user-email-env`        |     jira | Name of the environment variable holding the Jira account email used with the API token. The email itself is never written to config.                  |

The block is strict for the same reason `ship` is: an unknown key, including a
field from the other provider's shape, fails parsing rather than silently
disabling a setting you believe is on. `lightsout queue` requires both this
block and `queue`, and reports which one is absent. Credential values never live
in the file; only the names of the environment variables that hold them do.

Jira Cloud uses a Basic-auth API token and account email. Keep both values in
the environment, never in configuration:

```sh
export JIRA_API_TOKEN='your-api-token'
export JIRA_ACCOUNT_EMAIL='you@example.com'
```

```json
{
  "ticket-tracker": {
    "provider": "jira",
    "site-url": "https://example.atlassian.net",
    "project": "LO",
    "api-key-env": "JIRA_API_TOKEN",
    "api-user-email-env": "JIRA_ACCOUNT_EMAIL"
  }
}
```

### Queue settings

The `queue` block is what `lightsout queue` runs on. Without it the command refuses to start. Only `max-parallel` is required; the rest have defaults. Who the queue talks to lives in `ticket-tracker` above.

| Field                    | Required | What it controls                                                                                                                                                                                                                                                            |
| ------------------------ | -------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queue.planning-status-labels` |  no | The ticket label naming each planning status. Its five keys are `planning-needs-brainstorm`, `planning-needs-plan`, `planning-ready-auto-plan`, `planning-complete` and `planning-not-needed`; each is optional and defaults to the planning status spelled verbatim, so you override only the label your tracker spells differently. Exactly one of these labels on a ticket is the human's opt-in to automation — the queue never takes an unlabeled ticket. Two statuses may not share one label; the queue refuses at startup naming the repeated label. |
| `queue.max-parallel`     |      yes | How many tickets may be in flight at once. Also the ceiling on how many questions can ever wait for you at the same time.                                                                                                                                                    |
| `queue.eligible-statuses` |      no | Ticket statuses the queue may pick up. Defaults to `["Backlog", "Ready to implement"]`. Your ready status has to be one of them, or nothing waiting to be implemented is ever picked up.                                                                                     |
| `queue.ready-status`     |       no | Your tracker's name for the status a ticket waits at once its shaping is finished or was never needed. Defaults to `"Ready to implement"`. It must be one of `queue.eligible-statuses`, or the queue refuses at startup naming both keys.                                     |
| `queue.in-progress-status` |     no | Status the queue moves a ticket to when it picks it up. Defaults to `"In Progress"`.                                                                                                                                                                                        |
| `queue.done-status`      |       no | Your tracker's name for the status a ticket reaches once its merge is confirmed. Defaults to `"Done"`.                                                                                                                                                                       |
| `queue.setup`            |       no | Command run once in each fresh worktree before any agent, e.g. `pnpm install`. Absent means nothing runs.                                                                                                                                                                   |
| `queue.branch-template`  |       no | How a ticket becomes a branch name. `{ticket}` is the lowercased identifier, `{slug}` the slugged title. Defaults to `{ticket}-{slug}`. Whatever it produces must be matched by `ship.ticket-pattern`. A plan folder is named exactly like the branch this template produces.                                                                        |
| `queue.decisions-heading` |      no | The ticket-body heading relayed answers are appended under. Defaults to `## Decisions`.                                                                                                                                                                                     |
| `queue.worker-timeout`   |       no | Ceiling for one ticket's worker session, as a duration string like `90s`, `45m` or `4h`. Per ticket, never for the drain — the queue itself runs until the backlog is dry. A hit ceiling parks the ticket resumably. Defaults to `4h`.                                        |
| `queue.question-timeout` |       no | How long one relayed question waits for an answer before its ticket parks, as a duration string. Only `--file-relay` observes it; the terminal relay waits on the person at the terminal. Defaults to `1h`.                                                                   |
| `queue.parked-label`     |       no | The ticket label the queue sets when a ticket parks and clears when it resumes or ships. Opt-in with no default. Linear creates the team label on first use; Jira updates issue labels directly.                                                                            |
| `queue.route-labels`     |        — | Removed spelling. A config still carrying it fails to parse, with a message naming `queue.planning-status-labels` as the key that holds its value now.                                                                                                                       |

The block is strict for the same reason `ship` is: an unknown key fails parsing
rather than silently disabling a setting you believe is on. It contains queue
behaviour only — planning-status labels, tracker status names, parallelism,
setup, and timeouts. The tracker connection lives only in `ticket-tracker`.

The queue reads two things about a ticket — the planning status its label names,
and the status the ticket sits at — and takes work from exactly three pairs:

| Planning status | Tracker status | What runs |
| --- | --- | --- |
| `planning-ready-auto-plan` | Backlog | the ticket is planned first, then implemented |
| `planning-complete` | Ready to implement | the plan published to the ticket is implemented |
| `planning-not-needed` | Ready to implement | the ticket body is built straight |

Every other combination is left alone. `planning-needs-brainstorm` and
`planning-needs-plan` are the states a human is still shaping, and a
`planning-not-needed` ticket still in Backlog is not moved — putting a ticket
into Ready to implement is the shaping workflow's job. Backlog here means any
eligible status that is not your ready status.

### Plan settings

| Field                                  | Required | What it controls                                                                                                                                            |
| -------------------------------------- | -------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan.contract`                        |       no | When true, plans are written as contracts carrying an acceptance-test ledger, the structural lint requires that ledger, and `plan grade` weighs each plan file and spawns readers only for the heavy ones. Defaults to `false`. |
| `plan.weight-thresholds.created-files` |       no | A plan file creating more source files than this is heavy. Defaults to `3`.                                                                                  |
| `plan.weight-thresholds.packages`      |       no | A plan file touching more packages than this is heavy. Defaults to `1`.                                                                                      |

A contract plan carries what a test cannot detect — the file map, the full
exported signatures of every created file, the file each new file mirrors, and
the decisions — plus an `## Acceptance Tests` table with one row per acceptance
criterion: the criterion, the test file that states it, the exact test name, and
the gate that runs it. Behaviour a plan used to narrate in prose becomes a row.
A file whose behaviour no test can state — a document, a config file — is listed
under `## Prose Files` with the reason, and stays described in words.

A plan file is weighed from its own counts: it is heavy when it creates more
source files than `created-files`, when it touches more packages than
`packages`, or when it names no pattern to mirror. A heavy file gets the reader
fan-out once; a light one gets the structural lint and the ledger check and no
agent at all. `plan grade` prints each file's weight and every threshold it
crossed, and records both in `grade.json`.

The block is strict for the same reason `ship` is: an unknown key fails parsing
rather than silently disabling a setting you believe is on. Omit the block and
nothing changes — the same template, the same required sections, and every plan
file read by every lens.

### Auto-plan settings

| Field                            | Required | What it controls                                                                                                                                                                       |
| -------------------------------- | -------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto-plan.propose-before-draft` |       no | When true, the proposal comes before the plan is drafted and carries the design shape rather than the finished plan. Defaults to `false`, where the proposal shows the real, graded plan. |
| `auto-plan.implement-on-approval` |       no | When true, an approved proposal starts `/implement` rather than stopping at the hand-off line. Defaults to `false`: auto-plan only plans.                                                |
| `auto-plan.auto-approve-plan`    |       no | When true, the proposal is skipped entirely, provided nothing cleared the escalation bar; a question that clears it parks the run instead of being guessed past. Defaults to `false`.    |
| `auto-plan.auto-approve`         |        — | Removed spelling of `auto-approve-plan`. A config still carrying it fails to parse, with a message naming the key that replaced it.                                                      |

Every key is off by default, so an absent block is the most supervised behaviour there is — the skill plans the whole ticket, shows one proposal, and stops. Turning a key on is a repository saying the factory may carry on that far without asking. The block is strict for the same reason `ship` is.

### Docs settings

| Field | Required | What it controls |
| --------------- | -------: | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `docs[].path`   |      yes | Repo-relative path of a document the plan-time documentation check may name, e.g. `docs/configuration.md`.                                 |
| `docs[].covers` |      yes | One line saying what that document is responsible for. This is what tells a drafter where a given kind of change belongs.                  |

```json
{
	"docs": [
		{
			"path": "README.md",
			"covers": "The product tour: what lightsout is, what each command does, the walkthrough of a run, and the index of every other document."
		},
		{
			"path": "docs/configuration.md",
			"covers": "Every lightsout.config.json key: the generated top-level table, and the hand-written prose for each block and its keys."
		},
		{
			"path": "docs/monorepos.md",
			"covers": "How a monorepo is configured: the packages directory, scoped gate templates, and how a run picks the packages a change touched."
		}
	]
}
```

The block is entirely opt-in. Omit it and nothing changes: no `## Documentation`
section is required, no prompt text is added, no checker is spawned, and you are
never asked a new question.

Declare it and four seams switch on together. The plan writer is briefed on your
surfaces. The plan template asks every implementable plan file — a single plan,
and each phase file — for a `## Documentation` section stating either the
declared documents that plan touches or the exact sentence
`Nothing user-facing — no docs needed.` The structural lint requires that
section. And `plan grade` runs one whole-plan checker that verifies the stated
claim, reporting a blocking gap when a plan adds user-facing surface and touches
none of your declared documents.

The engine standardizes the question only — "does this plan touch a declared
surface?" — never a document's format, tone or structure. It never writes a
document, never judges its wording, and never opens one during the check.

At least one entry is required: an empty array would mean "declared, but
nothing", which opts into a check that can never fire. Each entry is strict for
the same reason `ship` is — a misspelled key fails parsing rather than silently
declaring a surface with no description.

### Removed spellings

`standards-packages` and `standardsPackages` are removed spellings of `standards-packs`,
and `auto-plan.auto-approve` is a removed spelling of `auto-plan.auto-approve-plan`. A
configuration still carrying one fails to parse, with a message naming the key that
replaced it.

The tracker connection moved out of `queue` because ticket operations such as
publishing a plan do not require a queue. The removed spellings map to the
top-level block as follows: `queue.tracker` → `ticket-tracker.provider`,
`queue.team` → `ticket-tracker.team`, `queue.site-url` →
`ticket-tracker.site-url`, `queue.project` → `ticket-tracker.project`,
`queue.api-key-env` → `ticket-tracker.api-key-env`, and
`queue.api-user-email-env` → `ticket-tracker.api-user-email-env`. A
configuration still carrying an old spelling fails to parse and names its new
home.

`queue.route-labels` → `queue.planning-status-labels`. The two-value route
vocabulary was replaced by the five planning statuses, so a configuration still
carrying the old key fails to parse and names the key that holds its value now.
Existing tickets keep their old labels until someone relabels them; nothing in
the engine reads a `route-` label any more.

That message is the live answer, which is why there is no list of every tombstone the
schema declares here.

### Harness-neutral keys

Two rules govern the keys above, and this surface depends on both:

- A key with a neutral name must mean the same thing on every harness. A capability only one harness has never gets a neutral key, because a key that reads as portable but silently does nothing is a failure you cannot see. If such a capability is ever needed, it goes under an explicitly harness-scoped block.
- `permissions` expresses intent, not identical enforcement. On Claude Code the commands granted through `agent-commands` are enforced by the harness itself. On Codex the workspace-write sandbox already permits commands, so the grant list the engine injects into the agent's prompt is what binds. On the pi-family harnesses the prompt grant is also what binds: `pi` has no permission system at all, and `omp`'s per-prefix grant would have to ride a config overlay that replaces the user's own command rules wholesale — not additive, so the engine does not use it. Under `omp`, `write` maps onto its approval tiers (file edits approved, command execution rejected headlessly) and `full-access` onto `yolo`; under `pi` both ride the prompt alone.

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

  // Standards packs, and which framework documents apply
  "standards-packs": ["standards/house-rules"],
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

  // Ship: how a branch reaches merged, and what its pull request says
  "ship": {
    "ticket-pattern": "^(?<ticket>[a-z]+-(?<number>\\d+))",
    "pr-body": "Closes ABC-{number}",
    "merge-method": "merge",
    "after-implement": false,
    "pre-ship": "node scripts/make-tree-shippable.mjs",
  },

  // Ticket tracker: who the engine talks to about a ticket
  "ticket-tracker": {
    "provider": "linear",
    "team": "ABC",
    "api-key-env": "LINEAR_API_KEY",
  },

  // Queue: which tickets to drain, and how many run at once.
  // The five planning-status labels and the four status names all default, so
  // a repository whose tracker spells them the same way configures none of them.
  "queue": {
    "max-parallel": 2,
    "setup": "pnpm install",
    "worker-timeout": "4h",
    "question-timeout": "1h",
    "parked-label": "queue-parked",
  },

  // Auto-plan: which of /auto-plan's checkpoints this repo keeps
  "auto-plan": {
    "propose-before-draft": true,
    "auto-approve-plan": true,
    "implement-on-approval": true,
  },

  // Documentation surfaces the plan check may name
  "docs": [
    {
      "path": "README.md",
      "covers": "The product tour, and the index of every other document.",
    },
    {
      "path": "docs/configuration.md",
      "covers": "Every configuration key, and the prose for each block.",
    },
  ],

  // Per-rule standards-check overrides
  "standards-checks": {
    // Our linter already enforces this one.
    "filename-mismatch": "off",
    // Ask for a longer duplicated stretch before it counts.
    "duplicate-code-block": { "settings": { "minTokens": 70 } },
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
