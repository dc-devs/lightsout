import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { LeftBehindTicket } from '#src/queue/common/types/LeftBehindTicket.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import { establishBranchMerge } from '#src/queue/common/utils/establishBranchMerge.ts';
import { settleReconciledWorktree } from '#src/queue/common/utils/settleReconciledWorktree.ts';
import { toTicketBranch } from '#src/queue/toTicketBranch.ts';
import { reconcileShippedTicket } from '#src/ticketLifecycle/index.ts';
import { resolveWorktreePath } from '#src/worktree/index.ts';

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
 * is about to skip. What counts as a merge is `establishBranchMerge`'s to say,
 * and this step skips whatever that function establishes and keeps the rest.
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
		const evidence = await establishBranchMerge({ cwd, branch, onProgress });

		if (evidence === undefined) {
			kept.push(ticket);
			continue;
		}

		const reconciliationFailure = await reconcileShippedTicket({ config, env, ticketRef: ticket.identifier, onProgress });

		if (reconciliationFailure !== undefined) {
			onProgress?.(reconciliationFailure);
		}

		const worktreePath = await resolveWorktreePath({ cwd, branch });
		const heldWorktree = await settleReconciledWorktree({ cwd, worktreePath, branch, onProgress });
		const established =
			evidence.pullRequest === undefined
				? `its branch ${branch} is recorded merged`
				: `its branch ${branch} already has a merged pull request #${evidence.pullRequest.number}`;
		const reason = `skipped: ${established}, so the ticket was reconciled to done rather than built again${heldWorktree ?? ''}${reconciliationFailure === undefined ? '' : ` — ${reconciliationFailure}`}`;

		leftBehind.push({
			identifier: ticket.identifier,
			title: ticket.title,
			url: ticket.url,
			reason,
			settled: true,
			...(reconciliationFailure === undefined ? {} : { reconciliationFailure }),
		});
	}

	return { kept, leftBehind };
};
