import { stat } from 'node:fs/promises';
import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';
import { runOrDescribeFailure } from '#src/common/processes/runOrDescribeFailure.ts';
import type { WorktreeOwner } from '#src/contracts/index.ts';
import type { WorktreeFailure } from '#src/worktree/common/types/WorktreeFailure.ts';
import { readWorktreeRecord, writeWorktreeRecord } from '#src/worktree/records/index.ts';
import { resolveWorktreePath } from '#src/worktree/resolveWorktreePath.ts';

interface Params {
	/** The checkout git runs in — the primary checkout, never the tree being made. */
	cwd: string;
	branch: string;
	/** What a new branch is cut from, composed by the caller — `origin/<default>` for a queue or implement tree, a commit sha for a planning tree. Unused for a branch that already exists, which is adopted at its own tip. */
	startPoint: string;
	/** Config `worktree.setup`, run inside the fresh tree. Skipped when undefined. */
	setup?: string;
	/** Who this tree belongs to, recorded durably so a later drain can tell. */
	owner: WorktreeOwner;
	/** True continues in a directory already sitting at the path, provided its ownership record does not name a different owner; false refuses any directory already there. */
	reuseExisting: boolean;
	onProgress?: (message: string) => void;
}

/** Whether a worktree is already sitting at this path — a run parked by an earlier drain. */
const exists = async ({ path }: { path: string }) => {
	const found = await stat(path).catch(() => undefined);

	return found !== undefined;
};

/** Whether git already knows this branch, which decides between cutting a new one and adopting what is there. */
const branchExists = async ({ cwd, branch }: { cwd: string; branch: string }) => {
	const shown = await runCommand({ command: `git rev-parse --verify --quiet refs/heads/${branch}`, cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);

	return shown?.exitCode === 0;
};

/**
 * Whether the directory already at the path may be continued in, or the reason
 * it may not.
 *
 * Every entry point places one ticket's tree at the same path on the same
 * branch, so a standalone run's tree and a drain's tree for one ticket collide
 * there and nothing in the path or the branch name tells them apart. The
 * parked scan's skip stops a drain RESUMING such a tree; this is what stops it
 * CREATING into one, which is a worker running inside a tree another run may
 * still be building in. Asked in the creator so no present or future caller can
 * forget it.
 *
 * A tree with no record at all is continued in as it always was: every tree
 * made before ownership was recorded carries none.
 */
const describeClaim = async ({ cwd, branch, owner, worktreePath }: { cwd: string; branch: string; owner: WorktreeOwner; worktreePath: string }) => {
	const record = await readWorktreeRecord({ cwd, branch });

	return record === undefined || record.owner === owner
		? undefined
		: `the worktree at ${worktreePath} belongs to a '${record.owner}' run, so it was left alone`;
};

/**
 * A fresh tree cut for the branch, its ownership and start point recorded and
 * the setup command run in it — or the step that refused.
 *
 * Ownership is recorded after the tree exists and before setup runs, so a
 * failed setup still leaves a tree a later run can attribute rather than adopt.
 */
const cutTree = async ({
	cwd,
	branch,
	startPoint,
	setup,
	owner,
	worktreePath,
	onProgress,
}: {
	cwd: string;
	branch: string;
	startPoint: string;
	setup?: string;
	owner: WorktreeOwner;
	worktreePath: string;
	onProgress?: (message: string) => void;
}) => {
	const adopting = await branchExists({ cwd, branch });
	const add = adopting ? `git worktree add ${worktreePath} ${branch}` : `git worktree add ${worktreePath} -b ${branch} ${startPoint}`;
	const addFailure = await runOrDescribeFailure({ command: add, cwd });

	if (addFailure !== undefined) {
		return { error: `git could not create a worktree for '${branch}': ${addFailure}` };
	}

	onProgress?.(`worktree ${worktreePath} on ${branch}`);
	// An adopted branch stands at its own tip and was never cut at `startPoint`,
	// so its record carries none — a record naming a commit the tree never stood
	// on would re-create it at the wrong one.
	await writeWorktreeRecord({ cwd, branch, owner, worktreePath, startPoint: adopting ? undefined : startPoint, onProgress });

	if (setup === undefined) {
		return undefined;
	}

	// An install is the slowest thing that happens here, and the git ceiling is
	// far too tight for it.
	const setupTimeoutMs = 600_000;
	const setupFailure = await runOrDescribeFailure({ command: setup, cwd: worktreePath, timeoutMs: setupTimeoutMs, subject: 'the command' });

	if (setupFailure !== undefined) {
		// An agent turned loose in a tree with no dependencies fails every gate
		// for the wrong reason, so a failed setup is the end of this ticket.
		return { error: `the queue's setup command failed in ${worktreePath}: ${setupFailure}` };
	}

	onProgress?.(`setup finished in ${worktreePath}`);

	return undefined;
};

/**
 * The worktree this run is built in, created if it is not already there.
 *
 * There is deliberately no `git fetch` here: the drain fetches once before it
 * starts, an isolated implementation run fetches before it calls this, and the
 * queue's serialized creation chain is what keeps concurrent tickets from
 * racing git in the main checkout. The start point is composed by the caller
 * for the same reason — a planning session pins its tree to the launching
 * checkout's commit rather than to the remote default.
 *
 * A branch that already exists with no worktree is adopted as it stands rather
 * than refused — a pre-made ticket branch is exactly what a branch-per-ticket
 * workflow produces, and a stale base is caught by the ship step's
 * rebase-plus-gates before it can merge.
 *
 * @returns the worktree's absolute path, or the step that refused
 */
export const createWorktree = async ({ cwd, branch, startPoint, setup, owner, reuseExisting, onProgress }: Params): Promise<string | WorktreeFailure> => {
	const worktreePath = await resolveWorktreePath({ cwd, branch });
	const alreadyThere = await exists({ path: worktreePath });

	if (alreadyThere && !reuseExisting) {
		return { error: `something is already at ${worktreePath}, so no worktree was made for '${branch}'` };
	}

	const claimed = alreadyThere ? await describeClaim({ cwd, branch, owner, worktreePath }) : undefined;

	if (claimed !== undefined) {
		return { error: claimed };
	}

	if (alreadyThere) {
		onProgress?.(`worktree already at ${worktreePath} — continuing in it`);
	}

	const failure = alreadyThere ? undefined : await cutTree({ cwd, branch, startPoint, setup, owner, worktreePath, onProgress });

	return failure ?? worktreePath;
};
