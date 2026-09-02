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
 * `<name>`, since `<n>` reads as a number everywhere else in this text.
 */
export const usageFixture = `lightsout — deterministic engine for coding agents

usage:
  lightsout implement --plan <path> [--overview <path>] [--packages <a,b>] [--cwd <path>] [--skip-refactor] [--ship] [--no-ship]
  lightsout implement --plan <folder> [--start-phase <n>] [--cwd <path>] [--skip-refactor] [--ship] [--no-ship]   (folder: overview.md runs all phases, else plan.md)
  lightsout implement-direct --ticket <path> [--ref <ticket>] [--cwd <path>] [--ship] [--no-ship]
  lightsout resume --run <id> [--cwd <path>] [--skip-refactor]
  lightsout ship [--cwd <path>]
  lightsout queue [--file-relay [dir]] [--cwd <path>]
  lightsout status [--cwd <path>]
  lightsout status [--run <id>] [--watch] [--cwd <path>]   (one run in detail; --watch repaints it every two minutes)
  lightsout doctor [--cwd <path>]
  lightsout standards-check [--cwd <path>] [--path <subdir>] [--all] [--baseline] [--code-checks | --agent-review]
  lightsout standards-check --list [--cwd <path>]     (print the enforcement ledger)
  lightsout standards-validate [--pack <path>] [--cwd <path>]   (run every check against its own fixtures)
  lightsout standards-health [--cwd <path>]           (per-rule coverage and how often agents decline it)
  lightsout refactor [--cwd <path>] [--path <subdir>] [--all] [--max-batches <n>] [--code-checks] [--allow-dirty]
  lightsout refactor --run <id> [--cwd <path>]        (resume a parked refactor run)
  lightsout test-coverage-to-threshold [--cwd <path>] [--max-batches <n>] [--allow-dirty]
  lightsout test-coverage-to-threshold --run <id> [--cwd <path>]   (resume a parked coverage run)
  lightsout plan verify-facts --name <name> [--notes <path>] [--cwd <path>]
  lightsout plan draft --name <name> [--scope single|phased] [--cwd <path>]
  lightsout plan lint --name <name> [--cwd <path>]
  lightsout plan dedup --name <name> [--cwd <path>]
  lightsout plan grade --name <name> [--phase <n[,n]>] [--cwd <path>]   (--phase grades only those phases, and always marks the result incomplete)
  lightsout plan publish --name <name> [--cwd <path>]
  lightsout friction [--cwd <path>]
  lightsout improve --engine <lightsout-repo-path> [--cwd <path>]
  lightsout voice on|off [--cwd <path>]               (toggle spoken read-out of interview questions — Mac-only)
  lightsout voice hook [--cwd <path>]                 (hook entry for Stop + AskUserQuestion: reads hook JSON on stdin, speaks the question)

exit codes (implement, resume, refactor, test-coverage-to-threshold):
  0  finished
  2  stopped with work left and resumable — a --max-batches ceiling, or a harness rate limit
  1  anything else
`;
