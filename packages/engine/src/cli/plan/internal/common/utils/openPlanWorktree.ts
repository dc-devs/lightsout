import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/internal/common/utils/createProgressPrinter.ts';
import type { PlanWorktree } from '#src/cli/plan/internal/common/types/PlanWorktree.ts';
import { resolvePlanWorktree } from '#src/cli/plan/internal/common/utils/resolvePlanWorktree.ts';
import { isSamePath } from '#src/common/utils/isSamePath.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';

interface Params {
	/** The checkout the command was launched from. */
	cwd: string;
	config: LightsoutConfig | undefined;
	flags: CommandContext['flags'];
	/** A plan address, or a legacy plan name. The branch is its ticket-branch segment rather than the name itself. */
	name: string;
}

/**
 * The checkout a planning session acts on, announced when the session moved into
 * it — or the one sentence saying why there is none.
 *
 * The tree holds code work only. A plan folder lives in the main checkout
 * whichever checkout a plan command runs from, so there is nothing to stock the
 * tree with and nothing inside it to lose when it is removed.
 */
export const openPlanWorktree = async ({ cwd, config, flags, name }: Params): Promise<{ worktree: PlanWorktree } | { error: string }> => {
	const worktree = await resolvePlanWorktree({ cwd, config, flags, name, onProgress: createProgressPrinter() });

	if ('error' in worktree) {
		return { error: worktree.error };
	}

	// Only a session that moved says so. One already standing in the tree — every
	// subcommand after `plan workspace` — has moved nowhere, and a line saying so
	// on every call would bury the output each subcommand exists to print.
	if (worktree.isolated && !(await isSamePath({ path: cwd, otherPath: worktree.cwd }))) {
		console.log(`lightsout: workspace ${worktree.cwd}\n  branch: ${worktree.branch}`);
	}

	return { worktree };
};
