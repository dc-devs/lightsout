import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import type { PlanWorktree } from '#src/cli/plan/common/types/PlanWorktree.ts';
import { copyPlanFolderToWorktree } from '#src/cli/plan/common/utils/copyPlanFolderToWorktree.ts';
import { resolvePlanWorktree } from '#src/cli/plan/common/utils/resolvePlanWorktree.ts';
import { isSamePath } from '#src/common/utils/isSamePath.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';

interface Params {
	/** The checkout the command was launched from. */
	cwd: string;
	config: LightsoutConfig | undefined;
	flags: CommandContext['flags'];
	/** The plan's name, which is also its branch. */
	name: string;
}

/**
 * The checkout a planning session acts on, announced when the session moved
 * into it and stocked with the plan folder the launching checkout holds — or the
 * one sentence saying why there is none.
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

	const copied = await copyPlanFolderToWorktree({ sourceCwd: cwd, worktree: worktree.cwd, name });

	return copied ?? { worktree };
};
