import { gitTimeoutMs } from '#src/common/constants/gitTimeoutMs.ts';
import { readGitRefCommit } from '#src/common/git/readGitRefCommit.ts';
import { runCommand } from '#src/common/processes/runCommand.ts';
import { runOrDescribeFailure } from '#src/common/processes/runOrDescribeFailure.ts';
import type { WorktreeFailure } from '#src/worktree/common/types/WorktreeFailure.ts';
import { readBranchWorktree } from '#src/worktree/readBranchWorktree.ts';

interface Params {
	cwd: string;
	/** The ticket branch — the ticket-folder segment of a plan address. */
	branch: string;
}

/** Whether git says the first commit is reachable from the second: undefined when git gave no usable answer at all. */
const readAncestry = async ({ cwd, ancestor, descendant }: { cwd: string; ancestor: string; descendant: string }) => {
	const asked = await runCommand({ command: `git merge-base --is-ancestor ${ancestor} ${descendant}`, cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);

	if (asked?.exitCode !== 0 && asked?.exitCode !== 1) {
		return undefined;
	}

	return asked.exitCode === 0;
};

/** How the local ticket branch stands against its pushed copy, or undefined when git could not say. */
const readBranchRelation = async ({ cwd, local, remote }: { cwd: string; local: string; remote: string }) => {
	const behind = await readAncestry({ cwd, ancestor: local, descendant: remote });
	const ahead = await readAncestry({ cwd, ancestor: remote, descendant: local });
	let relation: 'behind' | 'ahead' | 'diverged' | undefined;

	if (ahead === true) {
		relation = 'ahead';
	} else if (behind === true) {
		relation = 'behind';
	} else if (ahead === false && behind === false) {
		relation = 'diverged';
	}

	return relation;
};

/**
 * The local ticket branch moved onto the pushed commit, or the reason it was
 * left where it is.
 *
 * Only a branch no worktree holds is moved: `git branch -f` on a checked-out
 * branch would leave that tree's index describing a commit it no longer stands
 * on, so a tree holding the branch is the human's to update.
 */
const fastForwardTicketBranch = async ({ cwd, branch, local, remote }: { cwd: string; branch: string; local: string; remote: string }) => {
	const holder = await readBranchWorktree({ cwd, branch });

	if (holder !== undefined) {
		return {
			error: `the local branch '${branch}' at ${local} is behind the pushed one at ${remote}, and the worktree at ${holder} is standing on it — bring it up to date there with \`git pull --ff-only\``,
		};
	}

	const failure = await runOrDescribeFailure({ command: `git branch -f ${branch} ${remote}`, cwd });

	return failure === undefined ? { startPoint: undefined } : { error: `git could not move '${branch}' to the pushed commit ${remote}: ${failure}` };
};

/**
 * Where a plan address's ticket branch stands before a tree is cut for it or
 * continued in — and the start point to cut from when only the remote holds it.
 *
 * Every plan of a ticket implements on the one ticket branch, so a later plan
 * has to be researched and built on the implementation that branch already
 * carries. Starting from the launching checkout's `HEAD` or the default branch
 * would silently split the ticket's work in two.
 *
 * Nothing is fetched here: a remote-tracking ref answers what the last `git
 * fetch` left behind, and publishing planning artifacts never moves code — the
 * implementation commits travel by `git push` and `git fetch` alone.
 *
 * Only a strict fast-forward of a branch no worktree holds is done without
 * asking; a branch a tree is standing on, and a branch that has diverged, are
 * both refused with the two commits named, because reconciling them is a
 * decision only the human can make.
 *
 * @returns the commit a fresh tree's branch is cut at, no start point when the local branch stands as it should, or the one sentence saying what to do next
 */
export const prepareTicketBranch = async ({ cwd, branch }: Params): Promise<{ startPoint?: string } | WorktreeFailure> => {
	const local = await readGitRefCommit({ cwd, ref: `refs/heads/${branch}` });
	const remote = await readGitRefCommit({ cwd, ref: `refs/remotes/origin/${branch}` });

	if (remote === undefined || local === remote) {
		return {};
	}

	if (local === undefined) {
		return { startPoint: remote };
	}

	const relation = await readBranchRelation({ cwd, local, remote });
	let prepared: { startPoint?: string } | WorktreeFailure;

	if (relation === 'ahead') {
		prepared = {};
	} else if (relation === 'behind') {
		prepared = await fastForwardTicketBranch({ cwd, branch, local, remote });
	} else if (relation === 'diverged') {
		prepared = {
			error: `the local branch '${branch}' at ${local} has diverged from the pushed one at ${remote} — reconcile them before planning or implementing a later plan of this ticket`,
		};
	} else {
		prepared = { error: `git could not compare the local branch '${branch}' at ${local} with the pushed one at ${remote}` };
	}

	return prepared;
};
