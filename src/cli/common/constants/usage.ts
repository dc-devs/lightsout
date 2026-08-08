export const usage = `lightsout — deterministic engine for coding agents

usage:
  lightsout implement --plan <path> [--overview <path>] [--packages <a,b>] [--cwd <path>] [--skip-refactor]
  lightsout resume --run <id> [--cwd <path>] [--skip-refactor]
  lightsout status [--cwd <path>]
  lightsout doctor [--cwd <path>]
  lightsout standards-check [--cwd <path>] [--path <subdir>] [--all] [--baseline]
  lightsout refactor [--cwd <path>] [--path <subdir>] [--all] [--max-batches <n>]
  lightsout refactor --run <id> [--cwd <path>]        (resume a parked refactor run)
  lightsout plan verify-facts --name <n> [--notes <path>] [--cwd <path>]
  lightsout plan draft --name <n> [--scope single|phased] [--plans <dir>] [--cwd <path>]
  lightsout plan lint --name <n> [--plans <dir>] [--cwd <path>]
  lightsout plan dedup --name <n> [--plans <dir>] [--cwd <path>]
  lightsout plan grade --name <n> [--plans <dir>] [--cwd <path>]
  lightsout friction [--cwd <path>]
  lightsout improve --engine <lightsout-repo-path> [--cwd <path>]
`;
