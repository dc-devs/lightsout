import { copyRunInputs } from '#src/cli/common/implementRun/copyRunInputs.ts';
import { resolveRunWorkspace } from '#src/cli/common/implementRun/resolveRunWorkspace.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import type { RunWorkspace } from '#src/cli/common/types/RunWorkspace.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';

interface Params {
	/** The checkout the command was launched from. */
	cwd: string;
	config: LightsoutConfig;
	flags: CommandContext['flags'];
	/** `--ticket` exactly as the user typed it. */
	ticketPath: string;
	/** The ticket file's contents, already read from the launching checkout. */
	ticketBody: string;
	/** `--ref` exactly as the user typed it, when one was typed. */
	flaggedRef: string | undefined;
}

/**
 * Why the workspace cannot be committed in, or undefined when it can.
 *
 * The run ends in `git add -A`, and the tree it must not sweep is the one it
 * commits in — so this is asked of the workspace, not of the checkout the
 * command was launched from. A dirty launching checkout stops mattering the
 * moment the run builds somewhere else; with `--no-worktree` the two are the
 * same tree and the refusal is unchanged.
 */
const describeUncommittableTree = async ({ cwd }: { cwd: string }) => {
	const dirty = await readGitChangedFiles({ cwd });
	let refusal: string | undefined;

	if (dirty === undefined) {
		refusal = `git could not read the tree at ${cwd} — implement-direct commits what it builds, so it needs a readable git worktree`;
	} else if (dirty.length > 0) {
		refusal = 'implement-direct commits everything in the tree; commit or stash your changes first';
	}

	return refusal;
};

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
	ticketBody,
	flaggedRef,
}: Params): Promise<{ workspace: RunWorkspace; ticketPath: string } | { error: string }> => {
	const workspace = await resolveRunWorkspace({
		cwd,
		config,
		flags,
		ticketPath,
		ticketRef: flaggedRef,
		ticketBody,
		onProgress: createProgressPrinter(),
	});

	if ('error' in workspace) {
		return { error: workspace.error };
	}

	const uncommittable = await describeUncommittableTree({ cwd: workspace.cwd });

	if (uncommittable !== undefined) {
		return { error: uncommittable };
	}

	const copied = await copyRunInputs({ sourceCwd: cwd, workspace: workspace.cwd, ticketPath });

	return 'error' in copied ? { error: copied.error } : { workspace, ticketPath: copied.ticketPath ?? ticketPath };
};
