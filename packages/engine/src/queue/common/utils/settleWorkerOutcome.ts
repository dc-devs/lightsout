import { commitTicketWork } from '#src/commit/index.ts';
import { readGitCommitsAhead } from '#src/common/git/readGitCommitsAhead.ts';
import { BranchPhase } from '#src/contracts/index.ts';
import { writeBranchState } from '#src/queue/branchState/index.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';

interface Params {
	/** The main repository checkout, where the branch's phase is recorded. */
	cwd: string;
	/** The ticket's worktree, where its work is committed and counted. */
	worktreePath: string;
	branch: string;
	/** The default branch this branch's commits are counted against. */
	defaultBranch: string;
	ticket: RunnableTicket;
	/** The ticket's directory under the coordinator run, where the commit message file is written. */
	ticketRunDir: string;
	/** The configured generated paths, discarded before the commit. */
	generated: string[] | undefined;
	/** What the ticket's worker amounted to. */
	worked: WorkerOutcome;
	onProgress?: (message: string) => void;
}

/**
 * What one ticket's worker left behind, turned into the branch's verdict.
 *
 * There are three answers rather than two. A worker that failed parks and
 * commits nothing: committing work nothing vouches for would hand the ship step
 * a branch with no evidence behind it. A worker that left the ticket open
 * commits nothing either — every plan it built was already committed plan by
 * plan — and the branch is recorded open, which is what makes the next drain
 * re-evaluate the ticket rather than merge it.
 *
 * Anything else is committed and then judged ready when the branch carries
 * commits ahead of the default branch, whether or not this session added any, so
 * a resumed ticket whose work an earlier run committed is never reported as
 * having changed nothing. A branch git cannot count is not a fact worth
 * recording, so that answer parks the ticket and leaves the record where it was.
 *
 * @returns the part of the ticket's outcome the worker and the commit step decide
 */
export const settleWorkerOutcome = async ({
	cwd,
	worktreePath,
	branch,
	defaultBranch,
	ticket,
	ticketRunDir,
	generated,
	worked,
	onProgress,
}: Params): Promise<Pick<TicketRunOutcome, 'ready' | 'error' | 'open' | 'unanswered'>> => {
	if (worked.error !== undefined) {
		return { ready: false, error: worked.error, unanswered: worked.unanswered };
	}

	if (worked.open !== undefined) {
		await writeBranchState({ cwd, branch, phase: BranchPhase.Open, onProgress });

		// `error` and `unanswered` are stated absent rather than left off: every
		// other answer carries all three, and whoever asks whether this ticket
		// parked must never have to tell a missing key from an empty one.
		return { ready: false, open: worked.open, error: undefined, unanswered: undefined };
	}

	const committed = await commitTicketWork({
		cwd: worktreePath,
		message: `${ticket.identifier} ${ticket.title}`,
		runDir: ticketRunDir,
		generated,
		onProgress,
	});

	if ('error' in committed) {
		return { ready: false, error: committed.error };
	}

	const ahead = await readGitCommitsAhead({ cwd: worktreePath, defaultBranch });

	if (ahead === undefined) {
		return { ready: false, error: `git could not count the commits on ${branch}` };
	}

	if (ahead === 0) {
		return { ready: false, error: 'the worker left no commits on the branch' };
	}

	await writeBranchState({ cwd, branch, phase: BranchPhase.Ready, onProgress });

	return { ready: true };
};
