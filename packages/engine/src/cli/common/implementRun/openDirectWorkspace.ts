import { copyRunInputs } from '#src/cli/common/implementRun/copyRunInputs.ts';
import { describeUncommittableTree } from '#src/cli/common/implementRun/describeUncommittableTree.ts';
import { resolveRunWorkspace } from '#src/cli/common/implementRun/resolveRunWorkspace.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import type { RunWorkspace } from '#src/cli/common/types/RunWorkspace.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';

interface Params {
	/** The checkout the command was launched from. */
	cwd: string;
	config: LightsoutConfig;
	flags: CommandContext['flags'];
	/** `--ticket` exactly as the user typed it. */
	ticketPath: string;
	/** `--ref` exactly as the user typed it, when one was typed. */
	flaggedRef: string | undefined;
}

/**
 * The checkout an `implement-direct` run builds in, guarded and stocked with the
 * ticket the user named — or the one sentence saying why there is none.
 *
 * The order is the point: the workspace first, then the dirty-tree guard
 * against it, and only then the input copy, so the guard judges the tree the
 * run will commit rather than a tree the copy has already touched.
 */
export const openDirectWorkspace = async ({
	cwd,
	config,
	flags,
	ticketPath,
	flaggedRef,
}: Params): Promise<{ workspace: RunWorkspace; ticketPath: string } | { error: string }> => {
	const workspace = await resolveRunWorkspace({
		cwd,
		config,
		flags,
		ticketPath,
		ticketRef: flaggedRef,
		onProgress: createProgressPrinter(),
	});

	if ('error' in workspace) {
		return { error: workspace.error };
	}

	const uncommittable = await describeUncommittableTree({ cwd: workspace.cwd, isolated: workspace.isolated });

	if (uncommittable !== undefined) {
		return { error: uncommittable };
	}

	const copied = await copyRunInputs({ sourceCwd: cwd, workspace: workspace.cwd, ticketPath });

	return 'error' in copied ? { error: copied.error } : { workspace, ticketPath: copied.ticketPath ?? ticketPath };
};
