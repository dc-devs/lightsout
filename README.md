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
- **Improves the codebase with every run.** During planning, agents search for existing helpers and similar implementations, then identify where shared abstractions can replace duplicated logic. Every run ends with a bounded cleanup pass.
- **Puts deterministic gates between every stage.** Lightsout formats the full repository after each code-writing phase, then runs your tests, lint, type checks, and coverage commands directly instead of asking an agent to verify its own work. A red verification family receives a bounded repair allowance of its own before the run escalates.
- **Makes every run auditable.** All gate results, agent conversations, decisions, and costs are recorded in the run manifest. A successful run does not just claim it passed. It can prove it.

## Quick start

1. **Install lightsout.**

   In Claude Code:

   ```text
   /plugin marketplace add dc-devs/lightsout
   /plugin install lightsout@lightsout
   ```

   In Codex:

   ```sh
   codex plugin marketplace add dc-devs/lightsout
   codex plugin add lightsout@lightsout
   ```

   In OMP (Oh My Pi):

   ```sh
   omp plugin marketplace add dc-devs/lightsout
   omp plugin install lightsout@lightsout
   ```

   Under OMP the install is native: the skills load as first-class plugin
   skills, and spoken questions work through the extension the plugin ships —
   no Claude Code install needed alongside it.

   Claude Code lists every installed skill as a slash command of its own —
   `/lightsout:plan`, `/lightsout:implement`, `/lightsout:queue`, … — as
   soon as the plugin is installed. OMP and Pi do not list skills, so for
   them the plugin ships one slash command per skill instead: the same
   `/lightsout:plan`, `/lightsout:implement`, `/lightsout:queue`, … in OMP
   (type `/lightsout:` and pick from the list), and the bare `/plan`,
   `/implement`, `/queue`, … in Pi. The add-ons follow the same pattern
   (`/lightsout-linear:linear-ticket`, `/lightsout-jira:jira-ticket`). Each
   command is a thin router; the skill it names stays the single source of
   truth.

   The marketplace also carries optional `lightsout-linear` and `lightsout-jira`
   add-ons. They teach tracker-specific labels, statuses, attachments, and
   pull-request mechanics on top of the base ticket workflow. The queue adapters
   ship in `lightsout`; these add-ons contain only the tracker mechanics:

   ```text
   /plugin install lightsout-linear@lightsout
   /plugin install lightsout-jira@lightsout
   ```

   Or in Codex:

   ```sh
   codex plugin add lightsout-linear@lightsout
   codex plugin add lightsout-jira@lightsout
   ```

   To load the ticket workflow, an adopting repository adds one line to its
   own `CLAUDE.md` (Claude Code) or `AGENTS.md` (Codex) — the same line this
   repository carries:

   ```markdown
   One ticket = one branch = one PR, and a ticket folder holds its plans — follow the `ticket-workflow` skill, with `linear-ticket` or `jira-ticket` for tracker mechanics.
   ```

   The command examples below use Claude Code's slash-command form. In Codex,
   ask for the same installed skill by name, such as “use the `plan` skill” or
   “start the `queue` skill.”

2. **Define your standards and gate commands.**

Add a `lightsout.config.json` to the repository with your code standards and validation commands. Only the `gates` commands are mandatory — everything else is optional with sensible defaults. Leave `standards-packs` out and lightsout uses the standards pack it ships with. See [docs/configuration.md](docs/configuration.md) for all available options.

The factory runs the work on your own installed, logged-in coding agent.
Claude Code is the default; set `"harness"` to `"codex"`, `"omp"` (Oh My Pi)
or `"pi"` in the same file to run a different one, and `"model"` to name a
model of that harness (e.g. `"zai/glm-5.3"` on `omp`). The interactive
skills below — `/brainstorm`, `/plan`, the queue — are separate: they ship
as Claude Code and Codex plugins.

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

Use `/implement`, then walk away. The implementation agent follows the finished spec, writes the code and tests, and ends with a bounded cleanup pass. Deterministic gates verify every stage, and the complete run is recorded in .lightsout/runs/<id>/.

## Commands

### /brainstorm

Design before you build. `/brainstorm` turns a rough idea into a clear direction through dialogue. It asks questions, explores alternative approaches, explains the tradeoffs, and recommends a path forward.

Once the direction is settled, it decides its own outcome: ready to implement, when it can name every file that changes and nothing is left open, or ready to auto-plan otherwise. Both outcomes save the same two things — the design write-up, and the list of decisions that were settled, in a form the planning skills honor — and both publish those files to the ticket with `lightsout brainstorm publish`, so a fresh machine can read them.

On a ticket, the brainstorm works in one plan of that ticket's folder — the plan still waiting to be planned, or a new one it adds — and publishes under that plan's own attachment titles, so it never touches what another plan of the ticket settled.

```text
/brainstorm add rate limiting to the public API
```

### /plan

Turn the design into an executable spec. `/plan` explores the codebase, searches for existing helpers and similar implementations, and works through the scope, architecture, files touched, constraints, edge cases, abstractions, and acceptance criteria.

The plan is graded and revised until nothing is left for the implementation agent to guess, invent, or decide on its own.

Re-grading after a repair is cheap on purpose: the grader reads the phases that repair can reach rather than the whole plan, it stops before spawning anything when the mechanical checks already fail, and a question someone already settled is not asked again. A decision recorded about one phase names that phase, so the re-grade reads that phase and the phases connected to it; a decision that names no phase, a global constraint, or an overview edit outside the Decision Log still means the whole plan. Reader findings that describe one defect — the same contradiction reported from two phases, say — are weighed together in a single judgment and reported as one repair item that names every place the defect appears, and that item closes only once the fix is confirmed in each of those places. A finding no judge settled stays on record and blocks until one does. What does not get cheaper is approval — that still needs a passing review of the whole plan against the current code, standards and configuration.

With the `plan` config block turned on, the plan is a contract rather than a narrative: the file map, the exported signatures, the file each new file mirrors, the decisions, and an acceptance-test ledger naming one test per acceptance criterion. Such a repository is drafted from a dedicated contract template, so a file entry carries the signatures, the wiring and the constraints while every testable behaviour is an acceptance-test row rather than a paragraph. Files with no testable behaviour — documents, config — are listed separately and stay described in words. Each plan file is then weighed from its own counts, and a small one is graded by deterministic checks alone instead of by a fleet of readers.

When a plan starts from a `/brainstorm` hand-off, the decisions already settled there are carried straight into the plan rather than asked again; a settled decision is re-opened only when exploring the code turns up a concrete conflict.

The plan's Decision Log is composed by the engine from the saved decision records rather than typed out by the writer. `lightsout plan sync-decisions --name <name>` regenerates it in every file of the plan, and a decision's named phases show in its Choice cell — run it after a decision is recorded, and again as often as you like: a file whose log already matches the records is left untouched.

Once a ticket-backed plan is approved as ready, run `lightsout plan publish --name <name>`. It attaches only the durable design record — the single or
phased plan deliverable and whichever of `brainstorm-notes.md`, `decisions.json`,
`grade.json`, and `grade-memory.json` the folder holds — plus a small `plan-attachments.json` integrity
marker written last. Transcripts and other run state stay local. Publishing
again replaces each same-titled attachment, so an amended plan can be published
safely without creating duplicate attachments under those names.

Naming the plan by its address — `<ticket-branch>/<NNN-slug>` — publishes it
under its own plan id instead: every title becomes `<plan-id>--<file name>`,
with a `<plan-id>--plan-attachments.json` marker whose entries keep the bare
file names. Publishing one plan never lists, replaces or reports another plan's
attachments. `brainstorm-notes.md` is left to that plan's brainstorm generation,
which is published first whenever the notes on disk are not the bytes its marker
commits, and the ticket's own record is published beside them as `ticket.json`.
A folder named after its branch alone keeps bare titles and no record.

A brainstorm publishes its own record the same way: `lightsout brainstorm
publish --name <name>` attaches `brainstorm-notes.md` and
`brainstorm-decisions.json` plus a `brainstorm-attachments.json` integrity
marker written last, under its own title so it never collides with the plan's
generation. Under a plan address those titles carry the plan id prefix too, and
`brainstorm-decisions.json` is optional there — a plan of a ticket may be shaped
by a brainstorm that settled no decision of its own. `lightsout plan
verify-facts` fetches the brainstorm back into the plan folder, so planning on a
fresh machine starts from what the brainstorm settled.

A ticket can hold several plans. Its record says which mode it is in — single-plan,
where plan 001 alone supplies the implementation, or multiple-plan, where the
plans implement in numeric order on the one branch — seeded by
`plan.default-ticket-mode` when the record is created. Plans are created and
changed through `lightsout ticket`, never by hand, and a multiple-plan ticket
ships only once a human's ship request is satisfied. The `ticket-workflow` skill
is where those rules live; [`lightsout ticket`](#lightsout-ticket) is the command.

[![How /plan turns a request into an implementation-ready spec](assets/plan-workflow-light.svg)](assets/plan-workflow-light.svg)


Start from the notes `/brainstorm` saved:

```text
/plan .lightsout/plans/rate-limiting/brainstorm-notes.md
```

Or start from a plain description:

```text
/plan add rate limiting to the public API
```

### /auto-plan

Plan a ticket without the interview. `/auto-plan` does the work `/plan` does, but answers the questions itself — every question that falls below a written escalation bar. It stops only for the ones two reasonable engineers would answer differently.

It then shows one proposal, carrying a digest of every question it answered for itself. Any of those answers can be vetoed there.

What happens after you approve — stop at the hand-off line, or start the build — is the `auto-plan` config block's decision. Reach for it when the ticket is shaped enough that you would answer most of the interview with "you decide".

```text
/auto-plan LO-64
```

### /implement

Hand the finished spec to the factory. `/implement` follows the plan, writes the code and tests, and ends with a bounded cleanup pass. That pass buys another cleanup round only for a deterministic blocking finding the run's own edits introduced or measurably worsened — inherited debt and a reviewer's judgment call are recorded, never worked — and the number of rounds is capped at two by default, set by `implement.refactor.max-rounds`. Whatever cleanup leaves behind, the run carries on to its normal verification gates rather than stopping, and the run report says how many rounds were spent, why cleanup ended, what remains and what failed.

When the plan carries an acceptance-test ledger, the run writes those tests first — after the clean-slate gate run and before the implementation agent starts. From then on, every change an agent makes to a test file is compared against the version last approved for this run and judged by a separate agent that may only read, never write. A correction the plan's own changes force — an import pointing at a file the plan moved, a renamed fixture, a stale bit of setup — is approved and becomes the new approved version. Weakening what a test asserts, or deleting, renaming or skipping one of the ledger's named tests without the plan asking for it, is refused: the checkpoint goes red naming the test and the reason, and the agent is sent back to fix it. The engine never puts a file back on its own.

The run is not done until each named test has actually run and passed. The test command reports which individual tests it ran, and the engine reads that report, so a green command and an unchanged test name are not accepted as proof on their own.

After each code-writing stage, the full repository is formatted before deterministic gates run. If a test, lint, type-check, coverage, build, or formatting family fails, that family receives bounded repair attempts before the run escalates; root and package executions of the same family share the allowance. When the run succeeds, the complete record is written to `.lightsout/runs/<id>/`.

Gate runs are taken one at a time across every worktree of one repository on
one machine, so four queued tickets can no longer start `pnpm test` in the same
second and fail each other under load. The reservation is a shared
`.lightsout/gate-lock.json` in the repository's primary checkout. A run that
cannot have the machine says so, names the run and worktree holding it, and
keeps saying so while it waits; the wait is capped at 30 minutes and is
separate from each command's own timeout. A run whose wait expires stops there
and asks for a human: nothing was judged, so no fix agent is spent and no
supervisor is bought, and the worktree with every commit in it is left where it
is, ready to carry on once the machine is free. A repository that never runs
concurrent gates sees no change: the reservation is uncontended, taken without
a pause, and nothing is printed about waiting.

A run builds in its own git worktree by default, not in the checkout you
started it from, so your working copy stays free for the whole run and nothing
else in that tree is swept into the commit. The branch comes from the ticket
folder's name, or from the repository's configured branch template for a
ticket — never from whatever branch you happen to be standing on. The tree is
placed beside the repository in the same sibling directory the queue uses, cut
from the freshly fetched remote default branch, and stocked with a copy of the
plan or ticket the run was started from. An optional `worktree.setup` command —
`pnpm install`, say — runs once in the fresh tree before any agent. The run's
records stay in the checkout you launched from, so `lightsout status` still
finds the run and the record survives the worktree being cleaned up. Pass
`--no-worktree`, or set `implement.worktree` to false, to build in the
launching checkout instead. If the tree cannot be created, the inputs cannot be
copied, or setup fails, the run stops and says which it was — it never quietly
builds somewhere else.

Planning establishes that worktree first. `/plan` and `/auto-plan` run
`lightsout plan workspace --name <name>` before they explore or draft, which cuts
the tree at the plan's path from your checkout's committed `HEAD`, copies in any
plan folder you already have there, and prints the tree's path; every later plan
step works from it, so another agent editing your checkout cannot move the code
a grade is measured against. The implementation run then continues in that same
tree rather than cutting a second one, and a finished plan is copied back into
the checkout you launched from before the shipped tree is cleaned up. Pass
`--no-worktree`, or set `plan.worktree` to false, to plan in the launching
checkout deliberately.

When the name is a plan address — `<ticket-branch>/<NNN-slug>` — the tree is
the ticket branch's, so a later plan of the same ticket continues in it and is
researched against the implementation already there. That continuation is
refused while a live run holds the tree, naming the run. The whole ticket
folder, every plan in it, is copied back to your checkout before a shipped tree
is cleaned up.

A finished plan is not stuck on the machine that wrote it. `/implement` looks
for the plan folder on local disk first. When a ticket-named folder is absent,
it fetches that ticket's durable plan attachments and reconstructs the folder,
so a fresh clone can run the same plan without copying files by hand. The
integrity marker must name a complete generation and match every file's hash;
an interrupted or mixed publish is refused without leaving a partial folder.
It never restores transcripts or other run state. If neither source can supply
a plan, the run stops with one message naming both places it looked.

For a plan address the ticket's own record is settled first — written into the
primary checkout as `ticket.json` — and then that plan's prefixed generation is
restored into its folder. A record that moved both here and on the ticket is
never overwritten: the published copy is saved beside it as
`ticket.published.json`, and `lightsout ticket sync --name <ticket-branch>
--keep local` or `--keep published` says which copy wins. A plan folder that
gives way to a restore is renamed aside, never deleted. Publishing and restoring
move planning records only — implementation commits still travel by `git push`
and `git fetch`.

A run of a plan inside a ticket folder is checked against that ticket's record
before any tree is cut and before the tracker is told the ticket has started. A
plan whose lower-numbered sibling's implementation has not finished, a plan taken
out of the ticket's work, a plan other than 001 of a single-plan ticket, and a
plan already implemented are each refused in one sentence naming the plan in the
way and the command that resolves it. A run that does go ahead records the plan
as being implemented under the run's own id and the commit it started from, and
records what the run ended as — implemented with a snapshot of the plan's files,
or failed. A run of one phase file alone does not finish the plan's
implementation, and says so.

Shipping follows the ticket too. A multiple-plan ticket ignores `--ship` and
`ship.after-implement`: it chains into ship exactly when this run satisfies the
ship request a human asked for, and otherwise prints the one sentence saying what
it is still waiting for and exits on the run's own result. A single-plan ticket,
and a branch with no ticket record, chain exactly as they always have.

[![How /implement turns the spec into verified code](assets/implement-workflow-light.svg)](assets/implement-workflow-light.svg)

```text
/implement .lightsout/plans/rate-limiting/plan.md
```

### lightsout status

List every recorded run with `lightsout status`, or open one run's detailed progress block with its full or shortened id:

```text
lightsout status --run <id>
lightsout status --run <id> --watch
lightsout status --watch
lightsout status --planning <name>
lightsout status --shipping <branch>
lightsout status --queue
lightsout status --queue --run <id>
```

`--watch` refreshes the detailed block until the run stops. A failing verification row shows its gate families, root/package groups, per-family repair counts, whether a supervisor-guided repair ran, the supervisor diagnosis when present, and the final output line. The complete command, exit code, timing, and output-tail history remains in `.lightsout/runs/<run-id>/commands.jsonl`.

With no `--run`, `--watch` follows the one run that is going — a phased plan's coordinator and the phase it is running count as one run, not two — and waits a minute for a run you have only just started to appear. If several unrelated runs are going at once it names their ids and asks you to pick one with `--run <id>` rather than guessing which you meant. A watch already following a run stays with that run and never crosses to unrelated work.

`--planning <name>` shows a plan that is still being planned, printed once in the same layout as a run's block. It has five fixed steps — verify-facts, draft, dedup, grade and publish — and each `lightsout plan` subcommand records its own step in the plan folder as it runs: whether it is running, how it ended, how many times it ran and how long it took. A plan with no record yet shows every step not reached. An unreadable record prints one line naming the file. A step whose process has gone is not shown as running: it is drawn failed, and the block says no live process is recording it and when the record was last updated. The record stays on your machine — `lightsout plan publish` does not attach it to the ticket. `--planning` cannot be combined with `--run` or `--watch`.

`--shipping <branch>` shows a branch that is being shipped, printed once in the same layout as a run's block. It has six fixed steps — integrate, push, pull-request, checks, merge and sync — with the attempt number in the block's title. It reads the record from the checkout that ships the branch, so point it at a worktree with `--cwd <path>`. A branch with no record yet shows every step not reached. An unreadable record prints one line naming the file. A ship whose process has gone is never shown as running: its running step is drawn failed, and the block says no live process is recording it and when the record was last updated. `--shipping` cannot be combined with `--run`, `--watch` or `--planning`.

`--queue` shows a queue run as one update: first a board with seven columns — Build Queue, Building, Ship Queue, Shipping Now, Shipped, Parked and Blocked — then one block for each active ticket. A ticket is active while it is building, while it is shipping, or while its worker waits for an answer to a relayed question. Each block is exactly what the standalone `--run`, `--planning` or `--shipping` form prints for that ticket's worktree. It waits up to a minute for a queue that has just started, and prints a single line when no queue run is going. `--run <id>` names a past or crashed queue run instead: a crashed one is shown as stopped, with no ticket active. `--queue` prints once and cannot be combined with `--watch`, `--planning` or `--shipping`.

`lightsout resume --run <id>` picks a parked run back up in the workspace that run recorded, so a run built in its own worktree carries on in that worktree rather than in the checkout you happen to be standing in. Direct runs built from a ticket resume here too, from the ticket frozen beside the run: a run that already passed its gates goes straight to the commit and the ship rather than building the ticket again. If the recorded workspace has been removed, resume says so and stops.

### lightsout ship

Take a committed branch from where it stands to merged and cleaned up. `lightsout ship` merges the remote default branch into it, prepares the release with your own pre-ship command, runs your own gates against the result, commits what passed, pushes the branch, opens or adopts the pull request, waits for that commit's checks, merges, deletes the branch and syncs the default branch — then writes one JSON result a tracker skill can read. Nothing is committed or pushed before your gates are green: a merge conflict or a red gate gets a bounded agent recovery, and when that runs out the branch is put back exactly where ship found it. A merge the forge refuses because the default branch moved on, and a check that fails on the commit ship pushed, each earn another complete attempt; there are at most three per invocation. While it runs, ship also records each step's progress beside its result, and `lightsout status --shipping <branch>` reads it.

A branch whose ticket has a record merges only when that record authorizes it:
a single-plan ticket once plan 001 is implemented, a multiple-plan ticket once an
explicit ship request naming its included plans is satisfied. The record is asked
before anything is pushed and again immediately before the merge, so a plan added
to the ticket while its checks were running still stops it. A refusal is a blocked
result with reason `ticket-not-authorized` and one sentence saying what the ticket
is waiting for, and nothing reaches the remote. A branch with no ticket record
ships exactly as it always has. How a human files that request is the
`ticket-workflow` skill's `### Ship requests`.

It has no slash command of its own. Its house conventions — the branch pattern that carries a ticket reference, the pull request body, the merge method, and whether a passed `/implement` run chains straight into it — live in the `ship` config block. See [Configuration](docs/configuration.md).

```text
lightsout ship
```

### lightsout ticket-state

Write a ticket's planning status, its tracker workflow status, or both. The
planning status says what preparation the ticket still owes — it needs
brainstorming, it needs a plan, it is ready for the autonomous planner, its
shaping is complete, or it never needed any. The tracker status says where
implementation stands.

The workflow skills call it at each transition, so the tracker says the same
thing however the work was started. The tracker status is named by role rather
than by your workflow's own spelling, so one line works in every repository; the
names those roles resolve to live in the `queue` config block. See
[Configuration](docs/configuration.md).

```text
lightsout ticket-state --ref LO-88 --planning-status planning-complete --tracker-status ready
```

### lightsout ticket

A ticket owns one branch and a record of the numbered plans on it. Each plan is
addressed as the ticket's branch and the plan's id joined by a slash —
`lo-140-multi/002-queue-order` — and that address is what every `plan`
subcommand and `implement` are given. The record itself,
`.lightsout/plans/<ticket-branch>/ticket.json`, holds the ticket's mode, its
plans and how far each one's implementation has got, any plan taken out of that
work, and the request to ship.

`add-plan` starts the next plan and prints its address. `adopt` turns a folder
shaped before ticket records existed into plan 001, moving its files into the
plan's own folder and leaving them otherwise untouched. `mode` moves the ticket
between single-plan — plan 001 alone supplies the implementation, and this
repository's automatic shipping applies — and multiple-plan, where the plans
implement in numeric order on the one branch; a switch back to single-plan is
previewed first and only made with `--approve`, because it excludes every later
plan. `request-ship` is how a human declares a multiple-plan ticket finished,
and it must name every plan the ticket still includes; `--withdraw` takes it
back. `exclude-plan` takes one plan out of the ticket's work for good — a plan
whose implementation started is only excluded on a branch this repository's own
gates have just passed on — and `retitle-plan` changes only what a plan is
called, never its id, its folder or a pending request. `show` reads the record,
and `sync` settles one that moved on two machines at once.

Every change is published to the ticket when a `ticket-tracker` block is
configured, so another machine restores the ticket's settings and its plans;
implementation commits travel by `git push` and `git fetch` as they always did.
A plan folder with no record keeps working exactly as it did before. For what
`ship.after-implement` means to a single-plan ticket, see the `ship` block in
[Configuration](docs/configuration.md).

```text
lightsout ticket add-plan --name lo-140-multi --slug queue-order
lightsout ticket mode --name lo-140-multi --set multiple-plan
lightsout ticket request-ship --name lo-140-multi --plans 001-record,002-queue-order
```

### lightsout queue

Drain the backlog lights-out. `lightsout queue` reads the configured Linear team
or Jira project for every ticket whose planning status and tracker status form
one of three pairs, then works them in parallel git worktrees — one branch, one
PR, one merge per ticket.

The planning-status label is how a human opts a ticket in, and the pair names the worker. `planning-ready-auto-plan` in Backlog plans the ticket first — the same self-answering planner behind `/auto-plan` — and then implements the plan it wrote. `planning-complete` in Ready to implement builds the plan already published to the ticket, and `planning-not-needed` in Ready to implement builds straight from the ticket body. The planning status says what preparation a ticket still owes, the tracker status says where implementation stands, and the queue takes only the combinations where both agree the work is ready.

Each ticket gets a fresh worktree cut from the default branch, the config's `setup` command, and a harness run, with up to `max-parallel` tickets in flight at once — a budget the merge lane shares. The queue moves a ticket to In Progress before its worker touches source and to Done once a merge is confirmed, and it reconciles a ticket whose branch already merged rather than building it again. A ticket blocked by another ticket that is not finished is not picked up: it is left behind with the blocker named. Building and merging run at the same time: a finished branch is merged as soon as a slot is free, rather than waiting for unrelated builds it has nothing to do with. Merges are still taken one at a time, and the shared ship sequence is what brings the tip of the default branch into each branch and re-runs the gates before it goes in — the same preparation every shipping path gets. Every merge re-reads the tracker so the tickets it just unblocked join the run already in flight — a chain of dependent tickets ships in order, in one run. It stops when a re-read finds nothing new.

When a worker hits a question only a human can answer, the queue relays it: to your terminal by default, or — with `--file-relay` — to a mailbox the `queue` skill watches from a Claude Code or Codex session, so you can keep working and answer when asked. A question nobody answers parks its ticket after `question-timeout`; a later run picks parked work back up, worktree and all. A worktree whose ticket a human already closed is never resumed: if its branch merged, the ticket is reconciled to Done, and if it did not, the worktree is reported and left in place because it may hold work nobody has merged. The queue writes down where each branch stands — still being built, finished and waiting to merge, left open, or already merged — so a later run picks the work back up as what it actually is, and never rebuilds a branch that is already finished or merges one twice.

A ticket that owns several plans has the plans that are ready to implement built one at a time, lowest number first, each committed as its own commit — so a later plan is built on what the plans before it left, and any one plan's implementation can be taken out again by its own commit. A lower plan somebody is still planning holds the plans after it back. A plan whose implementation failed, or whose implementation has not finished, parks the ticket naming that plan, `lightsout resume` to finish it and `lightsout ticket exclude-plan` to take it out of the order — the queue repairs neither itself.

A ticket with several plans that nothing has yet approved shipping is left open rather than parked: it takes no parked label, keeps its tracker status and keeps its worktree, and a later run picks it up again to build whichever plans have since become ready to implement, or to ship it once its ship request is satisfied. For an auto-plan ticket the engine chooses which plan the session writes — the lowest plan still being planned, or a new plan 001 when the ticket has no plans yet.

A hold is the stronger case. Only one gate run at a time may use the machine across all of a repository's worktrees, and a run whose gates never got it within the wait ceiling stops without judging the code: no gate command ran, so nothing about the code failed. Its worktree and every commit in it are left exactly as they are, and the ticket is put on hold — recorded as the `queue-blocked-gate-timed-out` label beside the parked one. Neither a later `lightsout queue` run nor `lightsout resume` will take that ticket while the label stands. Removing the label from the ticket is what releases it; the queue never removes it for you.

When the queue ends it prints a final board, headed as finished, with every ticket in the column it ended in, and then its per-ticket report. With the `queue` skill, the conversation also gets a board at launch and a `lightsout status --queue` update every ten minutes while the queue drains. A queue held in a terminal prints no periodic board; run `lightsout status --queue` for one.

Exit codes carry the whole story: `0` — everything eligible shipped; `2` — work remains that a re-run picks up (parked or left-behind tickets), which a ticket left open is not, because it waits on a human decision rather than on a re-run; `1` — the queue refused to start, and the message says why.

It needs two blocks in `lightsout.config.json`: `ticket-tracker` holds the
provider-specific connection and names its credential environment variables;
`queue` holds planning statuses, tracker statuses, labels, parallelism, and
timeouts. The credential values can live in a gitignored `.env` at the
repository root: every command loads it, from a linked worktree too, and a
variable already exported always wins over the file. See
[Configuration](docs/configuration.md).

```text
lightsout queue --file-relay
```

### lightsout self-check

The engine's own check of a change, run by the agent that wrote it. `lightsout
self-check` runs the cheap gates the run's next checkpoint will run — types and
lint, the unit suite, the build — narrowed to the packages the live diff
touched, prints what went red, and exits 1 while anything is.

It is not a command you reach for. The engine grants it per spawn to the feature
executor, the refactor executor and the direct worker, so an agent sees the
failures it is about to be judged on while the plan and the standards are still
in its context — the cheapest failure to fix is the one the agent can still see.

It takes the live run's id and nothing else: which step, which gates, whether
coverage can answer, and what to scope to are all read from that run and from
git, so an argument an agent appends can never widen what it runs. It writes
nothing to the run, takes no lock, and decides nothing — the engine's own gates
run afterwards over the full scope and are the only verdict.

```text
lightsout self-check --run <id>
```

### /refactor

Turn existing technical debt into a gated refactoring run. `/refactor` runs the standards checks for duplicated logic, oversized files, structural violations, the shape of your test files, where folders and files sit and what they are called, and opportunities to replace repeated code with shared abstractions.

By default, it checks the entire repository. Use --path to target a specific directory and --max-batches to limit how many refactoring batches it completes. Agents fix each batch, and your deterministic gates verify the changes before the run continues.

Before each batch, an agent also reads the judgment-only rules against that batch's files and hands its findings to the fixing agent as advice. Use --code-checks to skip that review and run against the deterministic checks alone — faster and cheaper when the findings are mechanical.

A run normally demands a clean tree, so the ending diff is entirely the run's. Use --allow-dirty to accept uncommitted changes instead: they are recorded in the manifest as baseline and never attributed to a batch, which lets runs stack while you hold off committing. The pre-flight gates still have to pass either way.

Verified changes remain in your worktree for review and commit, and the complete record is written to `.lightsout/runs/<id>/`.

```text
/refactor --path <subdir> --max-batches <n>
```

### Working with your standards

Three commands answer questions about the standards themselves, rather than about your code.

`lightsout standards-check` reports what your repository breaks today. It has two halves and runs both by default: the checks your rules ship as code, and an agent reading the rules no code can check. `--code-checks` runs only the first, `--agent-review` only the second. The agent's findings are always advice — they never fail a run. A run including the code checks writes its report to `.lightsout/standards-check.json`; a review-only run prints and writes nothing, leaving that file as the last real check left it.

`lightsout standards-validate` runs every check in a standards pack against its own pass and fail fixtures. It is the gate to run while writing a rule: a check that lets its fail fixture through catches nothing, and one that flags its pass fixture cries wolf.

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
