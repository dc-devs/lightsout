import { join } from 'node:path';
import { readGitPrimaryCheckout } from '#src/common/git/readGitPrimaryCheckout.ts';

interface Params {
	/** The directory this run works in — a primary checkout, a linked worktree, or no repository at all. */
	cwd: string;
}

/**
 * The `.lightsout` folder every worktree of one repository shares: the primary
 * checkout's, or `cwd`'s own when no repository resolves.
 *
 * A linked worktree is a fresh checkout, so state kept in its own `.lightsout`
 * is invisible to its siblings — and cross-worktree coordination needs one file
 * all of them agree on. `readGitPrimaryCheckout` is git's own answer to which
 * checkout the siblings share, which `loadRepoEnvFile` already resolves inline
 * for the same reason.
 *
 * Outside a repository there are no siblings to coordinate with, so the run's
 * own folder is exactly right and nothing that works today starts failing. The
 * directory is never created here: whoever writes into it creates it, as
 * `acquireRunLock` does.
 */
export const resolveSharedStateDir = async ({ cwd }: Params): Promise<string> => {
	const primary = await readGitPrimaryCheckout({ cwd });

	return join(primary ?? cwd, '.lightsout');
};
