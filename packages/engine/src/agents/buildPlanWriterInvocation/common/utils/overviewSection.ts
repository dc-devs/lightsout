interface Params {
	path: string;
}

/**
 * The overview spawn's brief: author that one file, and nothing else. The phase
 * files are written by separate agents from the declarations this spawn settles,
 * so a phase it does not declare is never authored at all.
 */
export const overviewSection = ({ path }: Params): string =>
	`## Overview only

Author \`${path}\` and nothing else — not one phase file. A separate agent authors each phase file from the breakdown you write here, all of them at once, and none of them ever reads another phase's file. A phase you do not declare is never written.

That makes two sections load-bearing rather than decorative:

- \`## Phases\` — one row per phase, carrying its number, its \`phase<N>-<slug>.md\` filename, a one-line scope, and integer \`Creates\` and \`Touches\` counts. Numbers run 1..n with no gaps; each filename agrees with its number.
- \`## Phase Declarations\` — one \`### Phase <N> — \` block per row, listing ONLY what crosses a phase boundary: the files a later phase builds against, the exported names later phases import, and the package scripts that phase adds. Write \`none\` for a bullet with nothing to declare.

The counts are your estimate; the engine recomputes them from the finished phase files afterwards. The declarations are not an estimate — a phase writer is held to them.

Report only this file in \`filesWritten\`.`;
