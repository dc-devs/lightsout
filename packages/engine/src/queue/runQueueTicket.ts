import { join } from 'node:path';
import { readGitCommitsAhead } from '#src/common/git/readGitCommitsAhead.ts';
import { BranchPhase, type LightsoutConfig } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { readBranchState, writeBranchState } from '#src/queue/branchState/index.ts';
import { commitTicketWork } from '#src/queue/commitTicketWork.ts';
import type { QuestionRelay } from '#src/queue/common/types/QuestionRelay.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import { getWorktreesRoot } from '#src/queue/common/utils/getWorktreesRoot.ts';
import { createTicketWorktree } from '#src/queue/createTicketWorktree.ts';
import { runWorkerWithRelay } from '#src/queue/runWorkerWithRelay.ts';
import { toTicketBranch } from '#src/queue/toTicketBranch.ts';
import { TrackerStatusRole, updateTicketLifecycle } from '#src/ticketLifecycle/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	/** The main repository checkout. */
	cwd: string;
	settings: QueueSettings;
	trackerSettings: TrackerSettings;
	ticket: RunnableTicket;
	config: LightsoutConfig;
	driver: Driver;
	/** Recorded on the worker's manifest as the harness name. */
	driverName: string;
	/** The default branch, read once by the queue. */
	defaultBranch: string;
	relay: QuestionRelay;
	/** Queue-owned serializer wrapping every `git worktree add` in the main checkout — one chain built by the drain, shared by all tickets. */
	serializeWorktreeAdd: <Result>(params: { task: () => Promise<Result> }) => Promise<Result>;
	/** The coordinator run's id, stamped on every relayed question and answer. */
	coordinatorRunId: string;
	/** The coordinator run's directory in the main checkout — where the relay records Q&A, and where this ticket's commit message is written. */
	coordinatorRunDir: string;
	onProgress?: (message: string) => void;
}

/**
 * The opening record for a branch nobody has recorded yet.
 *
 * `building` is the opening state, not a reset. Writing it over a branch
 * already recorded `ready` and then failing in the worker would leave finished
 * work recorded as unfinished, and the next run would spend another worker on
 * it — so picking a recorded branch up writes nothing.
 */
const recordPickup = async ({ cwd, branch, onProgress }: { cwd: string; branch: string; onProgress?: (message: string) => void }) => {
	if ((await readBranchState({ cwd, branch })) === undefined) {
		await writeBranchState({ cwd, branch, phase: BranchPhase.Building, onProgress });
	}
};

/**
 * The commit step and the branch's verdict after it: ready when the branch
 * carries commits ahead of the default branch, whether or not this session
 * added any.
 *
 * `committed` no longer decides anything — it reports what this commit step
 * did. A branch git cannot count is not a fact worth recording, so that answer
 * parks the ticket and leaves the record where it was.
 */
const settleBranchReadiness = async ({
	cwd,
	worktreePath,
	branch,
	defaultBranch,
	ticket,
	coordinatorRunDir,
	onProgress,
}: {
	cwd: string;
	worktreePath: string;
	branch: string;
	defaultBranch: string;
	ticket: RunnableTicket;
	coordinatorRunDir: string;
	onProgress?: (message: string) => void;
}) => {
	const committed = await commitTicketWork({
		cwd: worktreePath,
		message: `${ticket.identifier} ${ticket.title}`,
		runDir: join(coordinatorRunDir, 'tickets', ticket.identifier),
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

/**
 * One ticket, from pickup to committed-and-ready.
 *
 * It deliberately does not ship: the queue merges the ready branches serially,
 * and a worker shipping itself would race that order. The worktree is never
 * removed here either — the ship step removes it after a merge, and a parked
 * tree is the evidence a human needs.
 *
 * A branch is settled ready when it carries commits ahead of the default
 * branch — whether or not this session added any — so a resumed ticket whose
 * work was committed by an earlier run is never reported as having changed
 * nothing.
 */
export const runQueueTicket = async ({
	cwd,
	settings,
	trackerSettings,
	ticket,
	config,
	driver,
	driverName,
	defaultBranch,
	relay,
	serializeWorktreeAdd,
	coordinatorRunId,
	coordinatorRunDir,
	onProgress,
}: Params): Promise<TicketRunOutcome> => {
	const branch = toTicketBranch({ ticket, template: settings.branchTemplate });
	// Creation is the one step that mutates the main checkout, so it alone goes
	// through the shared chain; everything after it runs fully parallel.
	const created = await serializeWorktreeAdd({ task: () => createTicketWorktree({ cwd, branch, defaultBranch, setup: settings.setup, onProgress }) });

	if (typeof created !== 'string') {
		return { ticket, branch, worktreePath: join(getWorktreesRoot({ cwd }), branch), ready: false, error: created.error };
	}

	const worktreePath = created;

	await recordPickup({ cwd, branch, onProgress });

	// Required state is recorded before ownership begins, so a tracker that cannot
	// record it stops this ticket before its worker touches source. Creating an
	// empty worktree is not source work; the worker is, and this write is complete
	// before it starts. The planning status is deliberately not written here: the
	// pickup must not erase the fact the parked scan re-reads to know which worker
	// to resume, and the implement edge settles it.
	const inProgress = settings.lifecycle.statusNames[TrackerStatusRole.InProgress];
	const moved = await updateTicketLifecycle({
		lifecycle: settings.lifecycle,
		trackerSettings,
		ticketId: ticket.id,
		trackerStatus: TrackerStatusRole.InProgress,
		currentStatus: ticket.status,
	});

	if (moved !== undefined) {
		return {
			ticket,
			branch,
			worktreePath,
			ready: false,
			error: `the ticket status could not be moved to '${inProgress}', so no source work began: ${moved.error}`,
		};
	}

	const worked = await runWorkerWithRelay({
		worktreePath,
		ticket,
		branch,
		config,
		driver,
		driverName,
		settings,
		trackerSettings,
		relay,
		coordinatorRunId,
		coordinatorRunDir,
		onProgress,
	});

	if (worked.error !== undefined) {
		// Committing work nothing vouches for would hand the ship step a branch
		// with no evidence behind it.
		return { ticket, branch, worktreePath, ready: false, error: worked.error, unanswered: worked.unanswered };
	}

	const readiness = await settleBranchReadiness({ cwd, worktreePath, branch, defaultBranch, ticket, coordinatorRunDir, onProgress });

	return { ticket, branch, worktreePath, ...readiness };
};
