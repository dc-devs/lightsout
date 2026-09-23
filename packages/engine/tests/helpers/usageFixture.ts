/**
 * The `--help` text as `renderUsage()` must produce it, written out by hand.
 *
 * A checked-in copy rather than a call into the renderer: a test that compared
 * the render to itself would prove nothing. This block is the pre-catalog
 * `usage.ts` verbatim, with one deliberate correction — `standards-validate`'s
 * note used to sit at column 68, a leftover of the older `--package` spelling,
 * and the renderer's single alignment rule re-flows it to column 65.
 *
 * A FEATURE adding a command or a flag updates this pin deliberately — updated
 * 2026-08-28 for `lightsout queue` and `lightsout implement-direct`, and
 * again for `queue --file-relay`, for `status --run` / `--watch`, and for
 * `lightsout plan publish` — which also spelled `--name`'s placeholder
 * `<name>`, since `<n>` reads as a number everywhere else in this text. Updated
 * again for `lightsout ticket-state`, again for
 * `lightsout brainstorm publish`, and again for `lightsout self-check` — the
 * engine's own check, which a writing agent runs inside its own spawn. Updated
 * once more for `lightsout plan sync-decisions` — the engine composing a plan's
 * Decision Log from its saved decision records. Updated again for the
 * `--worktree` / `--no-worktree` pair both implement commands now take, and
 * again for `status --planning` — one plan's planning steps in the run block's
 * layout — and again for `status --shipping`, one branch's ship steps in the
 * same layout. Updated 2026-09-11 for `status --queue` — the queue's board and
 * one status block per active ticket — and again for `lightsout plan workspace`
 * and the same pair on every plan subcommand. Updated again for `lightsout
 * ticket` — the eight subcommands that change and show a ticket's record of the
 * plans it holds, and once more when `ticket adopt` was merged into `ticket
 * add-plan --from` and the eight became seven. Updated again for
 * `lightsout report` — where one plan's or one ticket's hours and money went,
 * down to each harness process. Updated once more for `doctor --usage-probe` —
 * the opt-in check that one live harness call still reports its token fields.
 * Updated once more for `status --now` — the run that is going, printed once
 * — and for `status --queue --wait`, which is now what asks the queue form to
 * wait for a queue that has only just been launched. Updated 2026-09-21 when
 * `lightsout ticket` became `lightsout work-order`, its seven subcommands
 * keeping their words: `ticket-state` kept its name, because it is the one
 * command that genuinely writes to Linear or Jira. Updated once more when the
 * `--from` form of `add-plan` was removed, a work order's folder name having
 * become a label rather than an identity, so there is no folder move left to
 * perform. Updated once more for `lightsout work-order new` — the one command
 * that writes a work order's name, reading it from a tracker ticket behind
 * `--ticket` and taking the words as typed behind `--title`.
 */
export const usageFixture = `lightsout — deterministic engine for coding agents

usage:
  lightsout implement --plan <path> [--overview <path>] [--packages <a,b>] [--cwd <path>] [--skip-refactor] [--worktree] [--no-worktree] [--ship] [--no-ship]
  lightsout implement --plan <folder> [--start-phase <n>] [--cwd <path>] [--skip-refactor] [--worktree] [--no-worktree] [--ship] [--no-ship]   (folder: overview.md runs all phases, else plan.md)
  lightsout implement-direct --ticket <path> [--ref <ticket>] [--cwd <path>] [--worktree] [--no-worktree] [--ship] [--no-ship]
  lightsout resume --run <id> [--cwd <path>] [--skip-refactor] [--ship] [--no-ship]
  lightsout ship [--cwd <path>]
  lightsout queue [--file-relay [dir]] [--cwd <path>]
  lightsout status [--cwd <path>]
  lightsout status [--run <id>] [--watch] [--cwd <path>]   (one run in detail; --watch repaints it every two minutes, and without --run it follows the one run that is going)
  lightsout status --now [--cwd <path>]               (the run that is going, printed once; a phased plan shows its phase sequence and the phase moving now)
  lightsout status --planning <name> [--cwd <path>]   (one plan's planning steps, printed once)
  lightsout status --shipping <branch> [--cwd <path>]   (one branch's ship steps, read from the checkout that ships it)
  lightsout status --queue [--run <id>] [--wait] [--cwd <path>]   (the queue's board, then one status block per active ticket, printed once)
  lightsout report --plan <name> [--json] [--cwd <path>]
  lightsout doctor [--cwd <path>] [--usage-probe]
  lightsout standards-check [--cwd <path>] [--path <subdir>] [--all] [--baseline] [--code-checks | --agent-review]
  lightsout standards-check --list [--cwd <path>]     (print the enforcement ledger)
  lightsout standards-validate [--pack <path>] [--cwd <path>]   (run every check against its own fixtures)
  lightsout standards-health [--cwd <path>]           (per-rule coverage and how often agents decline it)
  lightsout refactor [--cwd <path>] [--path <subdir>] [--all] [--max-batches <n>] [--code-checks] [--allow-dirty]
  lightsout refactor --run <id> [--cwd <path>]        (resume a parked refactor run)
  lightsout test-coverage-to-threshold [--cwd <path>] [--max-batches <n>] [--allow-dirty]
  lightsout test-coverage-to-threshold --run <id> [--cwd <path>]   (resume a parked coverage run)
  lightsout brainstorm publish --name <name> [--cwd <path>]
  lightsout plan workspace --name <name> [--cwd <path>] [--worktree] [--no-worktree]
  lightsout plan verify-facts --name <name> [--notes <path>] [--cwd <path>] [--worktree] [--no-worktree]
  lightsout plan draft --name <name> [--legacy] [--scope single|phased] [--cwd <path>] [--worktree] [--no-worktree]
  lightsout plan sync-decisions --name <name> [--cwd <path>] [--worktree] [--no-worktree]
  lightsout plan lint --name <name> [--cwd <path>] [--worktree] [--no-worktree]
  lightsout plan dedup --name <name> [--cwd <path>] [--worktree] [--no-worktree]
  lightsout plan grade --name <name> [--phase <n[,n]>] [--cwd <path>] [--worktree] [--no-worktree]   (--phase grades only those phases, and always marks the result incomplete)
  lightsout plan publish --name <name> [--cwd <path>] [--worktree] [--no-worktree]
  lightsout work-order new [--ticket <ref> | --title <words>] [--cwd <path>]
  lightsout work-order add-plan --name <work-order-name> --slug <slug> [--title <title>] [--cwd <path>]
  lightsout work-order mode --name <work-order-name> --set single-plan|multiple-plan [--approve] [--cwd <path>]
  lightsout work-order request-ship --name <work-order-name> [--plans <id,id> | --withdraw] [--cwd <path>]
  lightsout work-order exclude-plan --name <work-order-name> --plan <id> --reason <text> [--implementation-removed] [--cwd <path>]
  lightsout work-order retitle-plan --name <work-order-name> --plan <id> --title <title> [--cwd <path>]
  lightsout work-order show --name <work-order-name> [--cwd <path>]
  lightsout work-order sync --name <work-order-name> [--keep local|published] [--cwd <path>]
  lightsout ticket-state --ref <ticket> [--planning-status <status>] [--tracker-status ready|in-progress] [--cwd <path>]
  lightsout self-check --run <id> [--cwd <path>]
  lightsout friction [--cwd <path>]
  lightsout improve --engine <lightsout-repo-path> [--cwd <path>]
  lightsout voice on|off [--cwd <path>]               (toggle spoken read-out of interview questions — Mac-only)
  lightsout voice hook [--cwd <path>]                 (hook entry for Stop + AskUserQuestion: reads hook JSON on stdin, speaks the question)

exit codes (implement, resume, refactor, test-coverage-to-threshold):
  0  finished
  2  stopped with work left and resumable — a --max-batches ceiling, or a harness rate limit
  1  anything else
`;
