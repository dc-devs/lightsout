export const usage = `lightsout — deterministic engine for coding agents

usage:
  lightsout implement --plan <path> [--overview <path>] [--packages <a,b>] [--cwd <path>] [--skip-refactor]
  lightsout implement --plan <folder> [--start-phase <n>] [--cwd <path>] [--skip-refactor]   (folder: overview.md runs all phases, else plan.md)
  lightsout resume --run <id> [--cwd <path>] [--skip-refactor]
  lightsout status [--cwd <path>]
  lightsout doctor [--cwd <path>]
  lightsout standards-check [--cwd <path>] [--path <subdir>] [--all] [--baseline] [--code-checks | --agent-review]
  lightsout standards-check --list [--cwd <path>]     (print the enforcement ledger)
  lightsout standards-validate [--package <path>] [--cwd <path>]   (run every check against its own fixtures)
  lightsout standards-health [--cwd <path>]           (per-rule coverage and how often agents decline it)
  lightsout refactor [--cwd <path>] [--path <subdir>] [--all] [--max-batches <n>] [--code-checks] [--allow-dirty]
  lightsout refactor --run <id> [--cwd <path>]        (resume a parked refactor run)
  lightsout test-coverage-to-threshold [--cwd <path>] [--max-batches <n>] [--allow-dirty]
  lightsout test-coverage-to-threshold --run <id> [--cwd <path>]   (resume a parked coverage run)
  lightsout plan verify-facts --name <n> [--notes <path>] [--cwd <path>]
  lightsout plan draft --name <n> [--scope single|phased] [--cwd <path>]
  lightsout plan lint --name <n> [--cwd <path>]
  lightsout plan dedup --name <n> [--cwd <path>]
  lightsout plan grade --name <n> [--cwd <path>]
  lightsout friction [--cwd <path>]
  lightsout improve --engine <lightsout-repo-path> [--cwd <path>]
  lightsout voice on|off [--cwd <path>]               (toggle spoken read-out of interview questions — Mac-only)
  lightsout voice hook [--cwd <path>]                 (hook entry for Stop + AskUserQuestion: reads hook JSON on stdin, speaks the question)
`;
