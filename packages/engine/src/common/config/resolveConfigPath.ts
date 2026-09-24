import { resolve } from 'node:path';

interface Params {
	cwd: string;
}

/**
 * The absolute path of the `lightsout.config.json` a command launched in `cwd`
 * reads — the one place that path is decided, so what a run reports as the file
 * it read is the file it did read.
 *
 * Absolute because the file is tracked, so every linked worktree carries its own
 * copy: a relative `--cwd` would print a path that cannot tell two checkouts apart.
 */
export const resolveConfigPath = ({ cwd }: Params): string => resolve(cwd, 'lightsout.config.json');
