import { join } from 'node:path';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { BranchPhase } from '#src/contracts/queue/BranchPhase.ts';
import { WorktreeOwner } from '#src/contracts/worktree/WorktreeOwner.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import { readBranchState } from '#src/queue/branchState/readBranchState.ts';
import { writeBranchState } from '#src/queue/branchState/writeBranchState.ts';
import type { NamedWorkOrder } from '#src/queue/common/types/NamedWorkOrder.ts';
import type { QuestionRelay } from '#src/queue/common/types/QuestionRelay.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { WorkOrderRunOutcome } from '#src/queue/common/types/WorkOrderRunOutcome.ts';
import type { RunnableTicket } from '#src/queue/internal/common/types/RunnableTicket.ts';
import { settleWorkerOutcome } from '#src/queue/internal/common/utils/settleWorkerOutcome.ts';
import { runWorkerWithRelay } from '#src/queue/workers/runWorkerWithRelay.ts';
import { TrackerStatusRole } from '#src/ticketLifecycle/common/constants/TrackerStatusRole.ts';
import { updateTicketLifecycle } from '#src/ticketLifecycle/updateTicketLifecycle.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { createWorktree } from '#src/worktree/createWorktree.ts';
import { resolveWorktreePath } from '#src/worktree/resolveWorktreePath.ts';

interface Params {
	/** The main repository checkout. */
	cwd: string;
	settings: QueueSettings;
	trackerSettings: TrackerSettings;
	/** The work order this run builds: its ticket, its label, and the branch its record stores. */
	workOrder: NamedWorkOrder;
	config: LightsoutConfig;
	driver: Driver;
	/** Recorded on the worker's manifest as the harness name. */
	driverName: string;
	/** The default branch, read once by the queue. */
	defaultBranch: string;
	/** The process environment the tracker credentials are read from. Passed rather than read, so a test never needs to mutate `process.env`. */
	env: NodeJS.ProcessEnv;
	relay: QuestionRelay;
	/** Queue-owned serializer wrapping every `git worktree add` in the main checkout — one chain built by the drain, shared by all tickets. */
	serializeWorktreeAdd: <Result>(params: { task: () => Promise<Result> }) => Promise<Result>;
	/** The coordinator run's id, stamped on every relayed question and answer. */
	coordinatorRunId: string;
	/** The coordinator run's own folder under the queue command's runs folder in the main checkout — where the relay records Q&A, and where this ticket's commit message is written. */
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
 * The work order's worktree, cut from the default branch or continued in.
 *
 * Creation is the one step that mutates the main checkout, so it alone goes
 * through the shared chain; everything after it runs fully parallel. Reuse is
 * on: a tree an earlier drain parked is continued in, exactly as it always was.
 * The owner is what makes a tree a standalone run made come back as a creation
 * failure rather than a tree to run a worker in.
 */
const createTicketWorktree = ({
	cwd,
	branch,
	defaultBranch,
	setup,
	serializeWorktreeAdd,
	onProgress,
}: {
	cwd: string;
	branch: string;
	defaultBranch: string;
	setup: QueueSettings['setup'];
	serializeWorktreeAdd: Params['serializeWorktreeAdd'];
	onProgress?: (message: string) => void;
}) =>
	serializeWorktreeAdd({
		task: () => createWorktree({ cwd, branch, startPoint: `origin/${defaultBranch}`, setup, owner: WorktreeOwner.Queue, reuseExisting: true, onProgress }),
	});

/**
 * The tracker write that claims the ticket, made before ownership begins.
 *
 * Required state is recorded before any source work, so a tracker that cannot
 * record it stops this ticket before its worker touches source. Creating an
 * empty worktree is not source work; the worker is, and this write is complete
 * before it starts. The planning status is deliberately not written here: the
 * pickup must not erase the fact the parked scan re-reads to know which worker
 * to resume, and the implement edge settles it.
 *
 * @returns the one sentence saying why no source work began, or undefined once the ticket is claimed
 */
const claimOwnership = async ({ settings, trackerSettings, ticket }: { settings: QueueSettings; trackerSettings: TrackerSettings; ticket: RunnableTicket }) => {
	const inProgress = settings.lifecycle.statusNames[TrackerStatusRole.InProgress];
	const moved = await updateTicketLifecycle({
		lifecycle: settings.lifecycle,
		trackerSettings,
		ticketId: ticket.id,
		trackerStatus: TrackerStatusRole.InProgress,
		currentStatus: ticket.status,
	});

	return moved === undefined ? undefined : `the ticket status could not be moved to '${inProgress}', so no source work began: ${moved.error}`;
};

/**
 * One ticket, from pickup to committed-and-ready, or left open.
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
 *
 * A worker that left the ticket open is the third answer: every plan it built was
 * already committed plan by plan, so nothing is committed and no commit is
 * counted here — the branch is recorded open, which is what makes the next drain
 * re-evaluate the ticket rather than merge it.
 */
export const runQueueWorkOrder = async ({
	cwd,
	settings,
	trackerSettings,
	workOrder,
	config,
	driver,
	driverName,
	defaultBranch,
	env,
	relay,
	serializeWorktreeAdd,
	coordinatorRunId,
	coordinatorRunDir,
	onProgress,
}: Params): Promise<WorkOrderRunOutcome> => {
	const { ticket, name, branch } = workOrder;
	// One directory for every commit message file this work order needs: the plan
	// loop's per-plan commits and the final commit below write to the same place.
	// It is keyed by the tracker identifier, which names the ticket rather than
	// the work order.
	const workOrderRunDir = join(coordinatorRunDir, 'work-orders', ticket.identifier);
	const created = await createTicketWorktree({ cwd, branch, defaultBranch, setup: settings.setup, serializeWorktreeAdd, onProgress });

	if (typeof created !== 'string') {
		return { ticket, name, branch, worktreePath: await resolveWorktreePath({ cwd, branch }), ready: false, error: created.error };
	}

	const worktreePath = created;

	await recordPickup({ cwd, branch, onProgress });

	const unclaimed = await claimOwnership({ settings, trackerSettings, ticket });

	if (unclaimed !== undefined) {
		return { ticket, name, branch, worktreePath, ready: false, error: unclaimed };
	}

	const worked = await runWorkerWithRelay({
		worktreePath,
		ticket,
		workOrderName: name,
		config,
		driver,
		driverName,
		settings,
		trackerSettings,
		relay,
		coordinatorRunId,
		coordinatorRunDir,
		workOrderRunDir,
		env,
		onProgress,
	});

	const settled = await settleWorkerOutcome({
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
	});

	return { ticket, name, branch, worktreePath, ...settled };
};
