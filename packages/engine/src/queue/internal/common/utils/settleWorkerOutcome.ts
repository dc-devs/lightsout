import { commitWorkOrderWork } from '#src/commit/commitWorkOrderWork.ts';
import { composeCommitMessage } from '#src/commit/composeCommitMessage.ts';
import { readGitCommitsAhead } from '#src/common/git/readGitCommitsAhead.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { BranchPhase } from '#src/contracts/queue/BranchPhase.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import { writeBranchState } from '#src/queue/branchState/writeBranchState.ts';
import type { WorkOrderRunOutcome } from '#src/queue/common/types/WorkOrderRunOutcome.ts';
import type { RunnableTicket } from '#src/queue/internal/common/types/RunnableTicket.ts';
import type { WorkerOutcome } from '#src/queue/internal/common/types/WorkerOutcome.ts';

interface Params {
	/** The main repository checkout, where the branch's phase is recorded. */
	cwd: string;
	/** The work order's worktree, where its work is committed and counted. */
	worktreePath: string;
	branch: string;
	/** The default branch this branch's commits are counted against. */
	defaultBranch: string;
	ticket: RunnableTicket;
	/** The ticket's directory under the coordinator run, where the commit message file is written. */
	workOrderRunDir: string;
	/** The run's config: its generated paths are discarded before the commit, and its model and effort drive the commit-message agent. */
	config: LightsoutConfig;
	/** The harness the queue already holds — the commit-message agent runs on it. */
	driver: Driver;
	/** The queue (coordinator) run, named on the final commit's `lightsout run` line. */
	coordinatorRunId: string;
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
	workOrderRunDir,
	config,
	driver,
	coordinatorRunId,
	worked,
	onProgress,
}: Params): Promise<Pick<WorkOrderRunOutcome, 'ready' | 'error' | 'open' | 'unanswered'>> => {
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

	const address = { reference: ticket.identifier, fallbackSubject: `${ticket.identifier} ${ticket.title}`, context: ticket.title };
	const committed = await commitWorkOrderWork({
		cwd: worktreePath,
		composeMessage: ({ cwd: worktree }) => composeCommitMessage({ cwd: worktree, driver, config, address, runId: coordinatorRunId, onProgress }),
		runDir: workOrderRunDir,
		generated: config.generated,
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
