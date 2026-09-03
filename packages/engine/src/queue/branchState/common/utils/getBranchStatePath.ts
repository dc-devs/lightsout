import { join } from 'node:path';

interface Params {
	/** The MAIN repository checkout, never a worktree. */
	cwd: string;
	branch: string;
}

/**
 * Every branch-state record gathers in one place:
 * `<repo>/.lightsout/branch-state/<branch>.json`.
 *
 * The branch is slugged rather than used as written, because a branch named
 * `feature/x` would otherwise write into a `feature` subdirectory, and the
 * queue's branch template is free to carry slashes.
 */
export const getBranchStatePath = ({ cwd, branch }: Params): string => {
	return join(cwd, '.lightsout', 'branch-state', `${branch.replace(/[^A-Za-z0-9._-]/g, '-')}.json`);
};
