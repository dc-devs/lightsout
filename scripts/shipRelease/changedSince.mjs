import { spawnSync } from 'node:child_process';
import { repoRoot } from './repoRoot.mjs';

/**
 * True when a path differs between a base commit and the WORKING TREE.
 *
 * The tree, not HEAD. The moment the version answer matters most is the moment
 * before the commit — `pnpm bundle` has just rewritten plugin/dist/cli.mjs and
 * it is sitting unstaged. Compared against HEAD, that rebuild is invisible, so
 * the check reported "nothing under plugin/ changed" while git showed 332
 * insertions in the same file, and asked for no bump. Omitting `...HEAD` makes
 * git compare the base against the tree, which is what the version comparison
 * needs.
 *
 * @param baseCommit - the commit the tree is compared against
 * @param path - the repository-relative path to compare
 */
export const changedSince = ({ baseCommit, path }) => {
	const result = spawnSync('git', ['diff', '--quiet', baseCommit, '--', path], { cwd: repoRoot, stdio: 'ignore' });

	return result.status !== 0;
};
