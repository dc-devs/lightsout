import { runGit } from '#src/ship/common/utils/runGit.ts';

interface Params {
	cwd: string;
}

/**
 * Whether git still has a merge in progress.
 *
 * Absence is the ordinary answer — a branch whose default branch had not moved
 * never started one — so this says only what git holds now, and never that
 * something is wrong.
 */
export const hasOpenMerge = async ({ cwd }: Params): Promise<boolean> =>
	(await runGit({ command: 'git rev-parse -q --verify MERGE_HEAD', cwd }))?.exitCode === 0;
