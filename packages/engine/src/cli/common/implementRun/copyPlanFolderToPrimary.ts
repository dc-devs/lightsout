import { cp } from 'node:fs/promises';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { pathExists, planWorkspaceDir } from '#src/plan/index.ts';

interface Params {
	/** The tree holding the plan folder — a shipped workspace about to be removed, or the tree planning left it in. Only read. */
	worktree: string;
	/** The checkout the folder is saved into. */
	primary: string;
	/** The plan's name — the folder under `.lightsout/plans/`. */
	name: string;
}

/**
 * Put the plan folder a worktree holds into another checkout, so removing the
 * tree can never delete the only local copy of a plan — including one with no
 * tracker ticket, which has no attachment to fall back on.
 *
 * The tree's folder is copied over what the destination holds, and a file only
 * the destination has is left in place: the tree's copy is the graded, repaired
 * one, and the goal is that nothing is lost rather than that the two agree. A
 * tree holding no folder for the plan has nothing to save, and nothing is
 * written. Nothing under the worktree is touched — taking the tree down is the
 * caller's step.
 *
 * @returns undefined when the folder was saved or there was none, or the one sentence naming the destination that could not be written
 */
export const copyPlanFolderToPrimary = async ({ worktree, primary, name }: Params): Promise<{ error: string } | undefined> => {
	const source = planWorkspaceDir({ cwd: worktree, name });
	const destination = planWorkspaceDir({ cwd: primary, name });
	let failure: { error: string } | undefined;

	if (await pathExists({ path: source })) {
		try {
			await cp(source, destination, { recursive: true });
		} catch (error) {
			failure = { error: `the plan folder could not be saved into ${destination}: ${messageOf({ error })}` };
		}
	}

	return failure;
};
