import { dirname } from 'node:path';
import { formatPlanAddress } from '#src/common/planAddress/formatPlanAddress.ts';
import { resolveSharedStateDir } from '#src/common/workspace/resolveSharedStateDir.ts';
import { pathExists, planWorkspaceDir } from '#src/plan/index.ts';
import { resolveWorktreePath } from '#src/worktree/index.ts';

interface Params {
	/** Any checkout of the repository the command was launched from. */
	cwd: string;
	ticketBranch: string;
	planId: string;
}

/**
 * Which checkout on this machine holds the copy of a plan that publishing would
 * send, and which other checkout holds a second copy of it.
 *
 * The sync sidecar is one per machine, so `--keep` has to act on the copies
 * this machine would publish from rather than on whichever checkout the command
 * happened to start in. The ticket branch's own worktree wins when it holds the
 * plan, because that is where the plan is being worked on; the primary checkout
 * answers otherwise, and the loser is reported so no stale copy is left behind
 * still publishable.
 */
export const resolvePlanWorkingCheckout = async ({ cwd, ticketBranch, planId }: Params): Promise<{ checkout: string; otherCopies: string[] }> => {
	const name = formatPlanAddress({ ticketBranch, planId });
	const worktree = await resolveWorktreePath({ cwd, branch: ticketBranch });
	const primary = dirname(await resolveSharedStateDir({ cwd }));
	const inWorktree = await pathExists({ path: planWorkspaceDir({ cwd: worktree, name }) });
	const inPrimary = worktree !== primary && (await pathExists({ path: planWorkspaceDir({ cwd: primary, name }) }));

	if (inWorktree) {
		return { checkout: worktree, otherCopies: inPrimary ? [primary] : [] };
	}

	return { checkout: primary, otherCopies: [] };
};
