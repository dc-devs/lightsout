import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import { getWorktreesRoot } from '#src/queue/common/utils/getWorktreesRoot.ts';
import { runOrDescribeFailure } from '#src/queue/common/utils/runOrDescribeFailure.ts';

interface Params {
	/** The main repository checkout. */
	cwd: string;
	branch: string;
	/** What the new branch is cut from — the queue reads it once and passes it down. */
	defaultBranch: string;
	/** Config `queue.setup`, run inside the fresh tree. Skipped when undefined. */
	setup?: string;
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
 * The worktree this ticket is built in, created if it is not already there.
 *
 * There is deliberately no `git fetch` here: the drain fetches once before it
 * starts, and its serialized creation chain is what keeps concurrent tickets
 * from racing git in the main checkout.
 *
 * A branch that already exists with no worktree is adopted as it stands rather
 * than refused — a pre-made ticket branch is exactly what a branch-per-ticket
 * workflow produces, and a stale base is caught by the ship step's
 * rebase-plus-gates before it can merge.
 *
 * @returns the worktree's absolute path, or the git command that refused
 */
export const createTicketWorktree = async ({ cwd, branch, defaultBranch, setup, onProgress }: Params): Promise<string | QueueFailure> => {
	const worktreePath = join(getWorktreesRoot({ cwd }), branch);

	if (await exists({ path: worktreePath })) {
		onProgress?.(`worktree already at ${worktreePath} — continuing in it`);

		return worktreePath;
	}

	const adopting = await branchExists({ cwd, branch });
	const add = adopting ? `git worktree add ${worktreePath} ${branch}` : `git worktree add ${worktreePath} -b ${branch} origin/${defaultBranch}`;
	const addFailure = await runOrDescribeFailure({ command: add, cwd });

	if (addFailure !== undefined) {
		return { error: `git could not create a worktree for '${branch}': ${addFailure}` };
	}

	onProgress?.(`worktree ${worktreePath} on ${branch}`);

	if (setup === undefined) {
		return worktreePath;
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

	return worktreePath;
};
