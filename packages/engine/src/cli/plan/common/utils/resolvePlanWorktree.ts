import { resolveWorktreeIsolation } from '#src/cli/common/args/resolveWorktreeIsolation.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import type { PlanWorktree } from '#src/cli/plan/common/types/PlanWorktree.ts';
import { readGitHeadCommit } from '#src/common/git/readGitHeadCommit.ts';
import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';
import { ticketFolderOf } from '#src/common/planAddress/ticketFolderOf.ts';
import { isSamePath } from '#src/common/utils/isSamePath.ts';
import { type LightsoutConfig, WorktreeOwner } from '#src/contracts/index.ts';
import { readLiveRunLock } from '#src/runState/index.ts';
import { createWorktree, prepareTicketBranch, readBranchWorktree, readWorktreeRecord, resolveWorktreePath } from '#src/worktree/index.ts';

interface Params {
	/** The checkout the command was launched from — `--cwd`, or the process directory. */
	cwd: string;
	/** The launching checkout's config, so a repository whose config is not yet committed still gets the isolation it asked for. */
	config: LightsoutConfig | undefined;
	flags: CommandContext['flags'];
	/** A plan address, or a legacy plan name. The branch is its ticket-branch segment, never the address. */
	name: string;
	onProgress?: (message: string) => void;
}

/** What every refusal about a tree offers the reader instead. */
const noWorktreeRemedy = 'pass --no-worktree to plan in the launching checkout deliberately';

/**
 * The tree already standing at the branch's path, continued in — or the refusal
 * when nothing proves it is this plan's.
 *
 * A `plan` record is a resumed session; a `queue` record is the drain's ticket
 * tree, which is already this plan's workspace. Neither record is re-stamped:
 * the queue's resume and cleanup recognise their tree by its own owner. A tree
 * nothing claims is refused, because an occupied directory is never evidence.
 *
 * For a plan address an `implement` record is accepted too: every plan of a
 * ticket lives on the one branch, so the tree an earlier plan's implementation
 * run adopted is exactly where the next plan must be researched. What separates
 * that from a run still editing the tree is the run lock, not the record, so an
 * address is refused whatever the owner while a live run holds it. A legacy name
 * accepts neither the `implement` record nor the lock question: its tree is one
 * plan's alone, and a run owning it means the plan is being built.
 */
const continueInTree = async ({ cwd, branch, addressed, treePath }: { cwd: string; branch: string; addressed: boolean; treePath: string }) => {
	const holder = addressed ? await readLiveRunLock({ cwd: treePath }) : undefined;

	if (holder !== undefined) {
		return { error: `the worktree at ${treePath} cannot be planned in: run ${holder.runId} is using it right now — wait for it, or ${noWorktreeRemedy}` };
	}

	const record = await readWorktreeRecord({ cwd, branch });
	const owners: WorktreeOwner[] = addressed ? [WorktreeOwner.Plan, WorktreeOwner.Queue, WorktreeOwner.Implement] : [WorktreeOwner.Plan, WorktreeOwner.Queue];

	if (record !== undefined && owners.includes(record.owner)) {
		return { cwd: treePath, branch, isolated: true, created: false };
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
 * already knows whatever start point it is handed — which is what puts a later
 * plan's tree on the ticket branch's current implementation.
 *
 * A ticket branch only the remote holds is the one case where neither of those
 * is right: `prepareTicketBranch` answers the pushed commit, and it wins, so the
 * local ticket branch is created at the implementation that was pushed rather
 * than at whatever this checkout happens to stand on.
 */
const cutPlanTree = async ({
	cwd,
	config,
	branch,
	pushedStartPoint,
	treePath,
	onProgress,
}: {
	cwd: string;
	config: LightsoutConfig | undefined;
	branch: string;
	pushedStartPoint: string | undefined;
	treePath: string;
	onProgress?: (message: string) => void;
}) => {
	const recorded = await readWorktreeRecord({ cwd, branch });
	const startPoint = pushedStartPoint ?? recorded?.startPoint ?? (await readGitHeadCommit({ cwd }));

	if (startPoint === undefined) {
		return { error: `no worktree was made at ${treePath}: the launching checkout has no commit to plan from — ${noWorktreeRemedy}` };
	}

	// `worktree.setup` runs here as it does for every other creator, because this
	// same tree becomes the implementation workspace.
	const created = await createWorktree({
		cwd,
		branch,
		startPoint,
		setup: config?.worktree?.setup,
		owner: WorktreeOwner.Plan,
		reuseExisting: false,
		onProgress,
	});

	return typeof created === 'string' ? { cwd: created, branch, isolated: true, created: true } : { error: `${created.error} — ${noWorktreeRemedy}` };
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
 * The branch is the plan's ticket folder, never the plan's own address, so every
 * plan of one ticket plans in the one tree on the one branch. For an address the
 * ticket branch is settled first — a branch only the remote holds supplies the
 * start point, and a branch behind or diverged from the pushed one is refused —
 * because a later plan must be researched against the implementation the branch
 * already carries.
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

	const addressed = parsePlanAddress({ name }) !== undefined;
	const branch = ticketFolderOf({ name });
	const treePath = await resolveWorktreePath({ cwd, branch });

	if (await isSamePath({ path: cwd, otherPath: treePath })) {
		return { cwd: treePath, branch, isolated: true, created: false };
	}

	// A legacy name keeps today's start points, so its branch is never inspected.
	const prepared = addressed ? await prepareTicketBranch({ cwd, branch }) : { startPoint: undefined };

	if ('error' in prepared) {
		return prepared;
	}

	const holder = await readBranchWorktree({ cwd, branch });
	let worktree: PlanWorktree | { error: string };

	if (holder === undefined) {
		worktree = await cutPlanTree({ cwd, config, branch, pushedStartPoint: prepared.startPoint, treePath, onProgress });
	} else if (await isSamePath({ path: holder, otherPath: treePath })) {
		worktree = await continueInTree({ cwd, branch, addressed, treePath });
	} else {
		worktree = { error: `'${branch}' is already checked out at ${holder} — plan from ${holder}, or ${noWorktreeRemedy}` };
	}

	return worktree;
};
