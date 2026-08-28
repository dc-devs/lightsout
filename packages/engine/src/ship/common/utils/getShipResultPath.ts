import { join } from 'node:path';

interface Params {
	cwd: string;
	/** The branch the result describes, or the literal `unknown` when git could not name one. */
	branch: string;
}

/**
 * Every ship result gathers in one place: `<repo>/.lightsout/ship/<branch>.json`.
 *
 * The branch is slugged rather than used as written, because a branch named
 * `feature/x` would otherwise write into a `feature` subdirectory a tracker
 * skill has no reason to look in.
 */
export const getShipResultPath = ({ cwd, branch }: Params): string => {
	return join(cwd, '.lightsout', 'ship', `${branch.replace(/[^A-Za-z0-9._-]/g, '-')}.json`);
};
