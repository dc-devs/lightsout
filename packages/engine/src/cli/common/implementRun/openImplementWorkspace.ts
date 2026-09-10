import { copyRunInputs } from '#src/cli/common/implementRun/copyRunInputs.ts';
import { resolveRunWorkspace } from '#src/cli/common/implementRun/resolveRunWorkspace.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import type { PlanTarget } from '#src/cli/common/types/PlanTarget.ts';
import type { RunWorkspace } from '#src/cli/common/types/RunWorkspace.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { resolvePlanTarget } from '#src/cli/common/utils/resolvePlanTarget.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';

interface Params {
	/** The checkout the command was launched from. */
	cwd: string;
	config: LightsoutConfig;
	flags: CommandContext['flags'];
	/** `--plan` exactly as the user typed it. */
	planPath: string;
}

/**
 * The checkout an `implement` run builds in and the plan target inside it,
 * announced before any source work — or the one sentence saying why there is
 * neither.
 *
 * The plan resolver is pure and side-effect free, so resolving the target a
 * second time here is honest rather than wasteful: the caller's first call
 * answered what the user pointed at, this one answers where that input now
 * lives, and an absolute `--plan` is normalised onto the copy by it.
 */
export const openImplementWorkspace = async ({
	cwd,
	config,
	flags,
	planPath,
}: Params): Promise<{ workspace: RunWorkspace; target: PlanTarget } | { error: string }> => {
	const workspace = await resolveRunWorkspace({ cwd, config, flags, planPath, onProgress: createProgressPrinter() });

	if ('error' in workspace) {
		return { error: workspace.error };
	}

	// Only an isolated run announces itself here. A run building where it was
	// launched has moved nowhere, and `printRunHeader` names that checkout on its
	// own `cwd:` line a few lines later — a second line saying the same thing
	// would push every other startup line down for no new fact.
	if (workspace.isolated) {
		console.log(`lightsout: workspace ${workspace.cwd}\n  branch: ${workspace.branch}`);
	}

	const copied = await copyRunInputs({ sourceCwd: cwd, workspace: workspace.cwd, planPath });

	if ('error' in copied) {
		return { error: copied.error };
	}

	const target = await resolvePlanTarget({ cwd: workspace.cwd, planPath: copied.planPath ?? planPath });

	return 'error' in target ? { error: target.error } : { workspace, target };
};
