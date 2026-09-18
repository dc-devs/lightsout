import { join } from 'node:path';
import { readGitPrimaryCheckout } from '#src/common/git/readGitPrimaryCheckout.ts';
import { isSamePath } from '#src/common/utils/isSamePath.ts';

interface Params {
	/** The directory the command runs in — a primary checkout, a linked worktree, or no repository at all. */
	cwd: string;
}

/**
 * The folder every plan workspace lives in — one gitignored directory under the
 * primary checkout's root, holding one folder per plan.
 *
 * `planWorkspaceDir` answers for one workspace inside it; this answers for the
 * folder itself, which is what listing every plan a repo has needs. It resolves
 * the primary checkout the way `resolveSharedStateDir` does, for the same
 * reason: every checkout of one repository must list one set of plans, and a
 * worktree that gets removed must take none of them with it. The primary is
 * resolved here rather than passed in because forty call sites can each pass
 * the wrong checkout, where one helper can be passed no checkout at all.
 *
 * `cwd`'s own spelling is kept whenever it names the primary itself: git answers
 * with a fully resolved path, so redirecting there would rewrite a caller's path
 * through every symlink above it while naming the very same directory.
 *
 * Outside a repository there is no primary to resolve and the run's own folder
 * is exactly right, so nothing that works today starts failing.
 */
export const plansDir = async ({ cwd }: Params): Promise<string> => {
	const primary = await readGitPrimaryCheckout({ cwd });
	const root = primary === undefined || (await isSamePath({ path: primary, otherPath: cwd })) ? cwd : primary;

	return join(root, '.lightsout', 'plans');
};
