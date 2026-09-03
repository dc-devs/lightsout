import { join } from 'node:path';
import { BranchPhase, type LightsoutConfig } from '#src/contracts/index.ts';
import { readBranchState, writeBranchState } from '#src/queue/branchState/index.ts';
import type { LeftBehindTicket } from '#src/queue/common/types/LeftBehindTicket.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import { getWorktreesRoot } from '#src/queue/common/utils/getWorktreesRoot.ts';
import { settleReconciledWorktree } from '#src/queue/common/utils/settleReconciledWorktree.ts';
import { toTicketBranch } from '#src/queue/toTicketBranch.ts';
import { findPullRequest, PullRequestState } from '#src/ship/index.ts';
import { reconcileShippedTicket } from '#src/ticketLifecycle/index.ts';

interface Params {
	/** The main repository checkout. */
	cwd: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	settings: QueueSettings;
	/** The wave's runnable tickets, in the order they would be picked up. */
	tickets: RunnableTicket[];
	onProgress?: (message: string) => void;
}

/**
 * The confirmed-merge skip: the tickets whose branches have not already merged,
 * and one left-behind entry per ticket whose branch has.
 *
 * It runs before any worktree is created or any tracker write is made, so the
 * one step that mutates the main checkout is never spent on a ticket the queue
 * is about to skip. A merge is *established* two ways — this queue's own record
 * of having merged the branch, read first so a machine that merged it stays
 * offline, or the forge reporting a merged pull request — and never inferred
 * from a missing branch, an absent open pull request or a clean worktree, so an
 * unreadable answer runs the worker.
 *
 * Sequential rather than parallel: an iteration may remove a worktree in the
 * main checkout, and the queue's rule is that main-checkout mutations do not
 * overlap.
 */
export const reconcileMergedTickets = async ({
	cwd,
	config,
	env,
	settings,
	tickets,
	onProgress,
}: Params): Promise<{ kept: RunnableTicket[]; leftBehind: LeftBehindTicket[] }> => {
	const kept: RunnableTicket[] = [];
	const leftBehind: LeftBehindTicket[] = [];

	for (const ticket of tickets) {
		const branch = toTicketBranch({ ticket, template: settings.branchTemplate });
		const recorded = await readBranchState({ cwd, branch });
		const recordedMerged = recorded?.phase === BranchPhase.Merged;
		const merged = recordedMerged ? undefined : await findPullRequest({ branch, cwd, state: PullRequestState.Merged });

		if (!recordedMerged && merged === undefined) {
			kept.push(ticket);
			continue;
		}

		const reconciliationFailure = await reconcileShippedTicket({ config, env, ticketRef: ticket.identifier, onProgress });

		if (reconciliationFailure !== undefined) {
			onProgress?.(reconciliationFailure);
		}

		if (merged !== undefined) {
			// The forge is what established this one, so the queue records it and
			// every later run answers offline.
			await writeBranchState({ cwd, branch, phase: BranchPhase.Merged, onProgress });
		}

		const heldWorktree = await settleReconciledWorktree({ cwd, worktreePath: join(getWorktreesRoot({ cwd }), branch), branch, onProgress });
		const established =
			merged === undefined ? `its branch ${branch} is recorded merged` : `its branch ${branch} already has a merged pull request #${merged.number}`;
		const reason = `skipped: ${established}, so the ticket was reconciled to done rather than built again${heldWorktree ?? ''}${reconciliationFailure === undefined ? '' : ` — ${reconciliationFailure}`}`;

		leftBehind.push({ identifier: ticket.identifier, reason, settled: true });
	}

	return { kept, leftBehind };
};
