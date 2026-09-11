import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import type { PlanWorktree } from '#src/cli/plan/common/types/PlanWorktree.ts';

interface Params {
	/** The tree `planCommand` already resolved — resolving again here could answer differently. */
	worktree: PlanWorktree;
}

/**
 * `lightsout plan workspace` — the deterministic subcommand both planning skills
 * run first, before they read a single source file.
 *
 * It has one outcome: a refusal never reaches it, because `planCommand` cannot
 * dispatch any subcommand without a checkout and exits with the resolver's
 * sentence first. The absolute path is written alone on the last stdout line,
 * below every progress and announcement line, so a skill reads it back without
 * parsing anything.
 */
export const planWorkspaceCommand = async ({ worktree }: Params): Promise<void> => {
	console.log(worktree.cwd);

	return exitCli({ code: 0 });
};
