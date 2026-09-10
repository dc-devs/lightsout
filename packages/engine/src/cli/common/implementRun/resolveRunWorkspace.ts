import { contradictoryWorktreeFlagsMessage } from '#src/cli/common/constants/contradictoryWorktreeFlagsMessage.ts';
import { linkRunRecords } from '#src/cli/common/implementRun/linkRunRecords.ts';
import { resolveRunBranch } from '#src/cli/common/implementRun/resolveRunBranch.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import type { RunWorkspace } from '#src/cli/common/types/RunWorkspace.ts';
import { type LightsoutConfig, WorktreeOwner } from '#src/contracts/index.ts';
import { createWorktree, fetchDefaultBranch, readBranchWorktree } from '#src/worktree/index.ts';

interface Params {
	/** The checkout the command was launched from — `--cwd`, or the process directory. */
	cwd: string;
	config: LightsoutConfig;
	flags: CommandContext['flags'];
	/** `--plan` exactly as the user typed it, for a plan-based run. Forwarded to `resolveRunBranch`. */
	planPath?: string;
	/** `--ticket` exactly as the user typed it, for a direct run. Forwarded to `resolveRunBranch`. */
	ticketPath?: string;
	/** `--ref` exactly as the user typed it, when a direct run named one. Forwarded to `resolveRunBranch`. */
	ticketRef?: string;
	/** The direct run's ticket body. Forwarded to `resolveRunBranch`. */
	ticketBody?: string;
	onProgress?: (message: string) => void;
}

/**
 * The tree this run is cut into, or the step that refused.
 *
 * Nothing here falls back to the launching checkout: a run that asked for
 * isolation and did not get it stops, because a gate run against the tree the
 * user happened to be standing on judges code the run is not building.
 */
const cutWorkspace = async ({
	cwd,
	config,
	branch,
	onProgress,
}: {
	cwd: string;
	config: LightsoutConfig;
	branch: string;
	onProgress?: (message: string) => void;
}) => {
	const holder = await readBranchWorktree({ cwd, branch });

	if (holder !== undefined) {
		return { error: `'${branch}' is already checked out at ${holder} — pass --no-worktree to build in that checkout deliberately` };
	}

	// A branch cut from a stale base is the thing this step exists to prevent,
	// so a failed fetch stops the run rather than answering from yesterday.
	const defaultBranch = await fetchDefaultBranch({ cwd });

	if (typeof defaultBranch !== 'string') {
		return defaultBranch;
	}

	// `reuseExisting: false` is what separates a standalone run from a drain: the
	// queue continues in a tree an earlier drain parked, and a standalone run
	// must not silently adopt a directory nobody claimed.
	const created = await createWorktree({
		cwd,
		branch,
		defaultBranch,
		setup: config.worktree?.setup,
		owner: WorktreeOwner.Implement,
		reuseExisting: false,
		onProgress,
	});

	if (typeof created !== 'string') {
		return created;
	}

	const linked = await linkRunRecords({ sourceCwd: cwd, workspace: created });

	return linked ?? created;
};

/**
 * The one resolver both implement commands call before any source work: the
 * checkout the run will act on, or one sentence saying why there is none.
 *
 * It takes the run's inputs rather than a branch already derived from them, and
 * calls `resolveRunBranch` itself only once isolation has been decided. That
 * order is a requirement rather than a preference: a run with isolation off
 * never needs a branch, so deriving one first would let a `--no-worktree` run
 * be refused because a loose input's stem happened to carry no branch-safe
 * characters. One resolver owning the order is also what keeps a refusal naming
 * the first real problem rather than a cascade.
 *
 * It never exits and never writes to the console — the command owns the exit
 * code and the printing — which is the shape `resolvePlanTarget` and
 * `ensurePlanWorkspace` already take.
 */
export const resolveRunWorkspace = async ({
	cwd,
	config,
	flags,
	planPath,
	ticketPath,
	ticketRef,
	ticketBody,
	onProgress,
}: Params): Promise<RunWorkspace | { error: string }> => {
	const asked = flags.get('worktree') === true;
	const refused = flags.get('no-worktree') === true;

	if (asked && refused) {
		return { error: contradictoryWorktreeFlagsMessage };
	}

	const isolated = refused ? false : asked || (config.implement?.worktree ?? true);

	if (!isolated) {
		return { cwd, isolated: false, created: false };
	}

	const branch = resolveRunBranch({ cwd, config, planPath, ticketPath, ticketRef, ticketBody });

	if (typeof branch !== 'string') {
		return branch;
	}

	const workspace = await cutWorkspace({ cwd, config, branch, onProgress });

	return typeof workspace === 'string' ? { cwd: workspace, branch, isolated: true, created: true } : workspace;
};
