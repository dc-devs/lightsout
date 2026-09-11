import { resolveWorktreeIsolation } from '#src/cli/common/args/resolveWorktreeIsolation.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import type { PlanWorktree } from '#src/cli/plan/common/types/PlanWorktree.ts';
import { readGitHeadCommit } from '#src/common/git/readGitHeadCommit.ts';
import { isSamePath } from '#src/common/utils/isSamePath.ts';
import { type LightsoutConfig, WorktreeOwner } from '#src/contracts/index.ts';
import { createWorktree, readBranchWorktree, readWorktreeRecord, resolveWorktreePath } from '#src/worktree/index.ts';

interface Params {
	/** The checkout the command was launched from — `--cwd`, or the process directory. */
	cwd: string;
	/** The launching checkout's config, so a repository whose config is not yet committed still gets the isolation it asked for. */
	config: LightsoutConfig | undefined;
	flags: CommandContext['flags'];
	/** The plan's name, which is also its branch. */
	name: string;
	onProgress?: (message: string) => void;
}

/** What every refusal about a tree offers the reader instead. */
const noWorktreeRemedy = 'pass --no-worktree to plan in the launching checkout deliberately';

/**
 * The tree already standing at the plan's path, continued in — or the refusal
 * when nothing proves it is this plan's.
 *
 * A `plan` record is a resumed session; a `queue` record is the drain's ticket
 * tree, which is already this plan's workspace. Neither record is re-stamped:
 * the queue's resume and cleanup recognise their tree by its own owner. A tree
 * an implementation run owns and a tree nothing claims are both refused, because
 * a branch collision and an occupied directory are never evidence.
 */
const continueInTree = async ({ cwd, name, treePath }: { cwd: string; name: string; treePath: string }) => {
	const record = await readWorktreeRecord({ cwd, branch: name });

	if (record?.owner === WorktreeOwner.Plan || record?.owner === WorktreeOwner.Queue) {
		return { cwd: treePath, branch: name, isolated: true, created: false };
	}

	const reason = record === undefined ? 'no ownership record claims it for this plan' : `its ownership record names a '${record.owner}' run, not this plan`;

	return { error: `the worktree at ${treePath} cannot be planned in: ${reason} — ${noWorktreeRemedy}` };
};

/**
 * A fresh tree cut for the plan, or the step that refused.
 *
 * The start point is captured once and recorded: a first cut takes the launching
 * checkout's committed HEAD, and a tree whose record already carries a start
 * point is re-cut at that same commit. A record with none belongs to a branch
 * that was adopted rather than cut, and `createWorktree` adopts a branch git
 * already knows whatever start point it is handed.
 */
const cutPlanTree = async ({
	cwd,
	config,
	name,
	treePath,
	onProgress,
}: {
	cwd: string;
	config: LightsoutConfig | undefined;
	name: string;
	treePath: string;
	onProgress?: (message: string) => void;
}) => {
	const recorded = await readWorktreeRecord({ cwd, branch: name });
	const startPoint = recorded?.startPoint ?? (await readGitHeadCommit({ cwd }));

	if (startPoint === undefined) {
		return { error: `no worktree was made at ${treePath}: the launching checkout has no commit to plan from — ${noWorktreeRemedy}` };
	}

	// `worktree.setup` runs here as it does for every other creator, because this
	// same tree becomes the implementation workspace.
	const created = await createWorktree({
		cwd,
		branch: name,
		startPoint,
		setup: config?.worktree?.setup,
		owner: WorktreeOwner.Plan,
		reuseExisting: false,
		onProgress,
	});

	return typeof created === 'string' ? { cwd: created, branch: name, isolated: true, created: true } : { error: `${created.error} — ${noWorktreeRemedy}` };
};

/**
 * The one resolver every plan subcommand goes through before anything reads the
 * disk: the checkout the session acts on, or one sentence saying why there is
 * none.
 *
 * The order is a requirement, for the reason `resolveRunWorkspace` gives: the
 * flags are read first, isolation is decided from the flags and then
 * `plan.worktree`, and nothing touches git at all when isolation is off. The
 * tree is `resolveWorktreePath`'s, so planning, the queue and `implement` agree
 * on where a branch's tree sits.
 *
 * A session already standing in that tree is answered as it stands, whatever
 * its record says: it adopts nothing, having moved nowhere, which is what keeps
 * every tree cut before ownership was recorded working. From anywhere else, the
 * record decides.
 *
 * It never falls back to the launching checkout, never exits and never writes to
 * the console — the command owns the exit code and the printing.
 */
export const resolvePlanWorktree = async ({ cwd, config, flags, name, onProgress }: Params): Promise<PlanWorktree | { error: string }> => {
	const isolated = resolveWorktreeIsolation({ flags, configured: config?.plan?.worktree });

	if (typeof isolated !== 'boolean') {
		return isolated;
	}

	if (!isolated) {
		return { cwd, isolated: false, created: false };
	}

	const treePath = await resolveWorktreePath({ cwd, branch: name });

	if (await isSamePath({ path: cwd, otherPath: treePath })) {
		return { cwd: treePath, branch: name, isolated: true, created: false };
	}

	const holder = await readBranchWorktree({ cwd, branch: name });
	let worktree: PlanWorktree | { error: string };

	if (holder === undefined) {
		worktree = await cutPlanTree({ cwd, config, name, treePath, onProgress });
	} else if (await isSamePath({ path: holder, otherPath: treePath })) {
		worktree = await continueInTree({ cwd, name, treePath });
	} else {
		worktree = { error: `'${name}' is already checked out at ${holder} — plan from ${holder}, or ${noWorktreeRemedy}` };
	}

	return worktree;
};
