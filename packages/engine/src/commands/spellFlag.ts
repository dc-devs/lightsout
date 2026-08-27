import type { CommandFlag } from '#src/contracts/index.ts';

interface Params {
	flag: CommandFlag;
}

/**
 * One flag as a reader types it, placeholder included: `--all`, `--plan <path>`.
 *
 * Published rather than kept beside the usage renderer because the CLI's
 * `--help` line and the web app's flag table both spell flags, and the catalog
 * exists so a flag is stated once — a spelling that could change on one surface
 * without changing on the other would be the second list it prevents.
 */
export const spellFlag = ({ flag }: Params): string => (flag.value === undefined ? `--${flag.name}` : `--${flag.name} ${flag.value}`);
