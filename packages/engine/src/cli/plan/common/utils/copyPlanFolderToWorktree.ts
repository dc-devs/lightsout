import { cp } from 'node:fs/promises';
import { isSamePath } from '#src/common/utils/isSamePath.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { pathExists, planWorkspaceDir } from '#src/plan/index.ts';

interface Params {
	/** The checkout the command was launched from. Only read — nothing under it is written, moved or deleted. */
	sourceCwd: string;
	/** The planning worktree. Equal to `sourceCwd` when isolation is off, where nothing is copied. */
	worktree: string;
	/** The plan's name — the folder under `.lightsout/plans/`. */
	name: string;
}

/**
 * Stock a planning worktree with the plan folder the launching checkout already
 * holds — a brainstorm's notes and decisions above all — so the session plans
 * from what was already settled.
 *
 * Copied, never moved, into the tree's gitignored `.lightsout/`, so nothing can
 * be swept into a commit by a later `git add -A`. An absent source folder is the
 * ordinary case — a plan started from a direct request has no artifacts yet —
 * and a folder the worktree already holds wins outright, the rule
 * `ensurePlanWorkspace` sets: a resumed session's graded plan is never clobbered
 * by a stale copy.
 *
 * @returns undefined when the worktree holds the folder or there was none to copy, or the one sentence saying why the copy failed
 */
export const copyPlanFolderToWorktree = async ({ sourceCwd, worktree, name }: Params): Promise<{ error: string } | undefined> => {
	const source = planWorkspaceDir({ cwd: sourceCwd, name });
	const destination = planWorkspaceDir({ cwd: worktree, name });
	const skipped =
		(await isSamePath({ path: worktree, otherPath: sourceCwd })) || !(await pathExists({ path: source })) || (await pathExists({ path: destination }));
	let failure: { error: string } | undefined;

	if (!skipped) {
		try {
			await cp(source, destination, { recursive: true });
		} catch (error) {
			failure = { error: `the plan folder ${source} could not be copied into the worktree at ${destination}: ${messageOf({ error })}` };
		}
	}

	return failure;
};
