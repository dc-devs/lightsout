import { join } from 'node:path';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { commitTicketWork } from '#src/queue/commitTicketWork.ts';
import type { QuestionRelay } from '#src/queue/common/services/QuestionRelay.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { getWorktreesRoot } from '#src/queue/common/utils/getWorktreesRoot.ts';
import { createTicketWorktree } from '#src/queue/createTicketWorktree.ts';
import { runWorkerWithRelay } from '#src/queue/runWorkerWithRelay.ts';
import { toTicketBranch } from '#src/queue/toTicketBranch.ts';
import { setTicketStatus } from '#src/queue/tracker/index.ts';

interface Params {
	/** The main repository checkout. */
	cwd: string;
	settings: QueueSettings;
	ticket: TicketSummary;
	config: LightsoutConfig;
	driver: Driver;
	/** Recorded on the worker's manifest as the harness name. */
	driverName: string;
	/** The default branch, read once by the queue. */
	defaultBranch: string;
	relay: QuestionRelay;
	/** Queue-owned serializer wrapping every `git worktree add` in the main checkout — one chain built by the drain, shared by all tickets. */
	serializeWorktreeAdd: <Result>(task: () => Promise<Result>) => Promise<Result>;
	/** The coordinator run's id, stamped on every relayed question and answer. */
	coordinatorRunId: string;
	/** The coordinator run's directory in the main checkout — where the relay records Q&A, and where this ticket's commit message is written. */
	coordinatorRunDir: string;
	onProgress?: (message: string) => void;
}

/**
 * One ticket, from pickup to committed-and-ready.
 *
 * It deliberately does not ship: the queue merges the ready branches serially,
 * and a worker shipping itself would race that order. The worktree is never
 * removed here either — the ship step removes it after a merge, and a parked
 * tree is the evidence a human needs.
 */
export const runQueueTicket = async ({
	cwd,
	settings,
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
	const created = await serializeWorktreeAdd(() => createTicketWorktree({ cwd, branch, defaultBranch, setup: settings.setup, onProgress }));

	if (typeof created !== 'string') {
		return { ticket, branch, worktreePath: join(getWorktreesRoot({ cwd }), branch), ready: false, error: created.error };
	}

	const worktreePath = created;
	const moved = await setTicketStatus({ settings, ticketId: ticket.id, statusName: settings.inProgressStatus });

	if (moved !== undefined) {
		// The tracker status is a courtesy to whoever is watching, never a
		// precondition for building.
		onProgress?.(`the ticket status could not be moved to '${settings.inProgressStatus}': ${moved.error}`);
	}

	const worked = await runWorkerWithRelay({
		worktreePath,
		ticket,
		config,
		driver,
		driverName,
		settings,
		relay,
		coordinatorRunId,
		coordinatorRunDir,
		onProgress,
	});

	if (worked.error !== undefined) {
		// Committing work nothing vouches for would hand the ship step a branch
		// with no evidence behind it.
		return { ticket, branch, worktreePath, ready: false, error: worked.error };
	}

	const committed = await commitTicketWork({
		cwd: worktreePath,
		message: `${ticket.identifier} ${ticket.title}`,
		runDir: join(coordinatorRunDir, 'tickets', ticket.identifier),
	});

	if ('error' in committed) {
		return { ticket, branch, worktreePath, ready: false, error: committed.error };
	}

	if (!committed.committed) {
		return { ticket, branch, worktreePath, ready: false, error: 'the worker changed nothing' };
	}

	return { ticket, branch, worktreePath, ready: true };
};
