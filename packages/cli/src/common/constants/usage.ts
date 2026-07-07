export const usage = `lightsout — deterministic engine for coding agents

usage:
  lightsout implement --plan <path> [--overview <path>] [--packages <a,b>] [--cwd <path>] [--skip-refactor]
  lightsout resume --run <id> [--cwd <path>] [--skip-refactor]
  lightsout status [--cwd <path>]
  lightsout doctor [--cwd <path>]
  lightsout scan [--cwd <path>] [--path <subdir>] [--all] [--baseline]
  lightsout refactor [--cwd <path>] [--path <subdir>] [--all] [--max-batches <n>]
  lightsout refactor --run <id> [--cwd <path>]        (resume a parked refactor run)
  lightsout traverse "<question>" --start <edge-or-node> [--connections <dir>] [--budget <n>] [--data <field>] [--cwd <path>]
  lightsout traverse --run <id> [--cwd <path>]        (resume a parked/budget-exhausted traversal)
  lightsout debug "<symptoms>" [--start <node>] [--at <file:line>] [--suspect <hash>] [--connections <dir>] [--budget <n>] [--cwd <path>]
  lightsout debug --run <id> [--cwd <path>]           (resume a parked/budget-exhausted debug run)
  lightsout build-map <node...|all> [--connections <dir>] [--rescan] [--cwd <path>]
  lightsout build-map --author <run-id> [--connections <dir>] [--cwd <path>]   (post-review: write docs from a culled join.json)
  lightsout map-connection verify [<doc-id>...] [--repair] [--connections <dir>] [--cwd <path>]
  lightsout map-connection draft --run <traverse-run-id> [--connections <dir>] [--cwd <path>]
  lightsout plan explore "<request>" --name <n> [--areas <a,b>] [--cwd <path>]
  lightsout plan draft --name <n> [--scope single|phased] [--plans <dir>] [--cwd <path>]
  lightsout plan dedup --name <n> [--plans <dir>] [--cwd <path>]
  lightsout plan grade --name <n> [--plans <dir>] [--cwd <path>]
  lightsout friction [--cwd <path>]
  lightsout improve --engine <lightsout-repo-path> [--cwd <path>]
`;
