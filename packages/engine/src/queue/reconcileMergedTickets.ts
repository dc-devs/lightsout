import { join } from 'node:path';
import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { LeftBehindTicket } from '#src/queue/common/types/LeftBehindTicket.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import { getWorktreesRoot } from '#src/queue/common/utils/getWorktreesRoot.ts';
import { removeTicketWorktree } from '#src/queue/removeTicketWorktree.ts';
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
 * The worktree a reconciled ticket leaves behind, settled: removed when the
 * tree is clean, kept when it is not.
 *
 * A reconciled ticket never reaches the ship step, which is the only other code
 * that removes a worktree — so leaving a clean one would make every later drain
 * rediscover work that already shipped. A dirty one is never removed: a merged
 * pull request says nothing about work begun in that directory since.
 *
 * @returns the sentence to append to the skip reason, or undefined when there was nothing to keep
 */
const settleReconciledWorktree = async ({ cwd, branch, onProgress }: { cwd: string; branch: string; onProgress?: (message: string) => void }) => {
	const worktreePath = join(getWorktreesRoot({ cwd }), branch);
	const changed = await readGitChangedFiles({ cwd: worktreePath });

	if (changed === undefined) {
		return undefined;
	}

	if (changed.length > 0) {
		onProgress?.(`the worktree at ${worktreePath} has uncommitted changes, so it was left in place`);

		return ` — the worktree at ${worktreePath} was left in place because it has uncommitted changes`;
	}

	await removeTicketWorktree({ cwd, worktreePath, branch });

	return undefined;
};

/**
 * The confirmed-merge skip: the tickets whose branches have not already merged,
 * and one left-behind entry per ticket whose branch has.
 *
 * It runs before any worktree is created or any tracker write is made, so the
 * one step that mutates the main checkout is never spent on a ticket the queue
 * is about to skip. A merge is only ever *confirmed* — the forge reporting a
 * merged pull request on the branch — never inferred from a missing branch, an
 * absent open pull request or a clean worktree, so an unreadable answer runs
 * the worker.
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
		const merged = await findPullRequest({ branch, cwd, state: PullRequestState.Merged });

		if (merged === undefined) {
			kept.push(ticket);
			continue;
		}

		const reconciliationFailure = await reconcileShippedTicket({ config, env, ticketRef: ticket.identifier, onProgress });

		if (reconciliationFailure !== undefined) {
			onProgress?.(reconciliationFailure);
		}

		const heldWorktree = await settleReconciledWorktree({ cwd, branch, onProgress });
		const reason = `skipped: its branch ${branch} already has a merged pull request #${merged.number}, so the ticket was reconciled to done rather than built again${heldWorktree ?? ''}${reconciliationFailure === undefined ? '' : ` — ${reconciliationFailure}`}`;

		leftBehind.push({ identifier: ticket.identifier, reason, settled: true });
	}

	return { kept, leftBehind };
};
